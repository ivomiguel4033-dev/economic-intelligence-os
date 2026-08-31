import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 4 });
const hash = (payload) => createHash("sha256").update(payload).digest("hex");

async function register(event) {
  const payloadHash = hash(event.rawPayload);
  const result = await pool.query(
    `INSERT INTO billing_webhook_events (stripe_event_id, event_type, livemode, payload_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING stripe_event_id`,
    [event.id, event.type, event.livemode, payloadHash],
  );
  if (result.rowCount) return "new";

  const existing = await pool.query(
    `SELECT event_type, livemode, payload_hash, processed_at, processing_error
     FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [event.id],
  );
  const persisted = existing.rows[0];
  if (!persisted) throw new Error("conflicted event could not be reloaded");
  if (
    persisted.event_type !== event.type ||
    persisted.livemode !== event.livemode ||
    persisted.payload_hash !== payloadHash
  ) throw new Error("replay does not match persisted event");

  if (!persisted.processed_at && persisted.processing_error) {
    const claimed = await pool.query(
      `UPDATE billing_webhook_events
       SET retry_started_at=now()
       WHERE stripe_event_id=$1
         AND processed_at IS NULL
         AND processing_error IS NOT NULL
         AND (retry_started_at IS NULL OR retry_started_at < now() - interval '5 minutes')
       RETURNING stripe_event_id`,
      [event.id],
    );
    if (claimed.rowCount) return "retry";
  }

  return "duplicate";
}

async function markFailed(eventId, message) {
  await pool.query(
    `UPDATE billing_webhook_events
     SET processing_error=$2, retry_started_at=NULL
     WHERE stripe_event_id=$1`,
    [eventId, message],
  );
}

async function markProcessed(eventId) {
  await pool.query(
    `UPDATE billing_webhook_events
     SET processed_at=now(), processing_error=NULL, retry_started_at=NULL
     WHERE stripe_event_id=$1`,
    [eventId],
  );
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const base = {
    id: `evt_regression_${suffix}`,
    type: "invoice.paid",
    livemode: false,
    rawPayload: JSON.stringify({ id: suffix, amount: 1000 }),
  };

  assert.equal(await register(base), "new");
  assert.equal(await register(base), "duplicate");

  for (const mutation of [
    { type: "invoice.payment_failed" },
    { livemode: true },
    { rawPayload: JSON.stringify({ id: suffix, amount: 2000 }) },
  ]) {
    await assert.rejects(() => register({ ...base, ...mutation }), /does not match/);
  }

  const failed = {
    ...base,
    id: `evt_failed_${suffix}`,
    rawPayload: JSON.stringify({ id: `failed-${suffix}`, amount: 3000 }),
  };
  assert.equal(await register(failed), "new");
  await markFailed(failed.id, "transient processor failure");

  const concurrentRetries = await Promise.all([register(failed), register(failed)]);
  assert.deepEqual(concurrentRetries.sort(), ["duplicate", "retry"]);

  const activeClaim = await pool.query(
    `SELECT retry_started_at FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.ok(activeClaim.rows[0].retry_started_at);

  assert.equal(await register(failed), "duplicate");

  await pool.query(
    `UPDATE billing_webhook_events
     SET retry_started_at=now() - interval '6 minutes'
     WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.equal(await register(failed), "retry");

  await markProcessed(failed.id);
  assert.equal(await register(failed), "duplicate");

  const failedPersisted = await pool.query(
    `SELECT processed_at, processing_error, retry_started_at
     FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.ok(failedPersisted.rows[0].processed_at);
  assert.equal(failedPersisted.rows[0].processing_error, null);
  assert.equal(failedPersisted.rows[0].retry_started_at, null);

  const persisted = await pool.query(
    `SELECT event_type, livemode, payload_hash FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [base.id],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].event_type, base.type);
  assert.equal(persisted.rows[0].livemode, base.livemode);
  assert.equal(persisted.rows[0].payload_hash, hash(base.rawPayload));

  console.log("Stripe event idempotency and retry-claim regression checks passed");
} finally {
  await pool.end();
}
