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
     RETURNING processing_generation`,
    [event.id, event.type, event.livemode, payloadHash],
  );
  if (result.rowCount) return { status: "new", generation: Number(result.rows[0].processing_generation) };

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

  if (!persisted.processed_at) {
    const claimed = await pool.query(
      `UPDATE billing_webhook_events
       SET retry_started_at=now(), processing_generation=processing_generation + 1
       WHERE stripe_event_id=$1
         AND processed_at IS NULL
         AND (
           processing_error IS NOT NULL
           OR created_at < now() - interval '5 minutes'
         )
         AND (retry_started_at IS NULL OR retry_started_at < now() - interval '5 minutes')
       RETURNING processing_generation`,
      [event.id],
    );
    if (claimed.rowCount) return { status: "retry", generation: Number(claimed.rows[0].processing_generation) };
  }

  return { status: "duplicate" };
}

async function markFailed(eventId, generation, message) {
  const result = await pool.query(
    `UPDATE billing_webhook_events
     SET processing_error=$3, retry_started_at=NULL
     WHERE stripe_event_id=$1 AND processing_generation=$2`,
    [eventId, generation, message],
  );
  return Boolean(result.rowCount);
}

async function markProcessed(eventId, generation) {
  const result = await pool.query(
    `UPDATE billing_webhook_events
     SET processed_at=now(), processing_error=NULL, retry_started_at=NULL
     WHERE stripe_event_id=$1 AND processing_generation=$2`,
    [eventId, generation],
  );
  return Boolean(result.rowCount);
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const base = {
    id: `evt_regression_${suffix}`,
    type: "invoice.paid",
    livemode: false,
    rawPayload: JSON.stringify({ id: suffix, amount: 1000 }),
  };

  const initial = await register(base);
  assert.deepEqual(initial, { status: "new", generation: 1 });
  assert.deepEqual(await register(base), { status: "duplicate" });

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
  const failedInitial = await register(failed);
  assert.deepEqual(failedInitial, { status: "new", generation: 1 });
  assert.equal(await markFailed(failed.id, failedInitial.generation, "transient processor failure"), true);

  const concurrentRetries = await Promise.all([register(failed), register(failed)]);
  const retry = concurrentRetries.find((entry) => entry.status === "retry");
  const duplicate = concurrentRetries.find((entry) => entry.status === "duplicate");
  assert.ok(retry);
  assert.deepEqual(duplicate, { status: "duplicate" });
  assert.equal(retry.generation, 2);

  const activeClaim = await pool.query(
    `SELECT retry_started_at FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.ok(activeClaim.rows[0].retry_started_at);

  assert.deepEqual(await register(failed), { status: "duplicate" });

  await pool.query(
    `UPDATE billing_webhook_events
     SET retry_started_at=now() - interval '6 minutes'
     WHERE stripe_event_id=$1`,
    [failed.id],
  );
  const secondRetry = await register(failed);
  assert.deepEqual(secondRetry, { status: "retry", generation: 3 });

  // Fencing regression: a stale worker from generation 2 must not be able to
  // finalize or record failure after generation 3 has reclaimed the event.
  assert.equal(await markProcessed(failed.id, retry.generation), false);
  assert.equal(await markFailed(failed.id, retry.generation, "stale worker failure"), false);

  const beforeCurrentFinalization = await pool.query(
    `SELECT processed_at, processing_error, processing_generation
     FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.equal(beforeCurrentFinalization.rows[0].processed_at, null);
  assert.equal(beforeCurrentFinalization.rows[0].processing_error, "transient processor failure");
  assert.equal(Number(beforeCurrentFinalization.rows[0].processing_generation), secondRetry.generation);

  assert.equal(await markProcessed(failed.id, secondRetry.generation), true);
  assert.deepEqual(await register(failed), { status: "duplicate" });

  const failedPersisted = await pool.query(
    `SELECT processed_at, processing_error, retry_started_at
     FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [failed.id],
  );
  assert.ok(failedPersisted.rows[0].processed_at);
  assert.equal(failedPersisted.rows[0].processing_error, null);
  assert.equal(failedPersisted.rows[0].retry_started_at, null);

  const abandoned = {
    ...base,
    id: `evt_abandoned_${suffix}`,
    rawPayload: JSON.stringify({ id: `abandoned-${suffix}`, amount: 4000 }),
  };
  const abandonedInitial = await register(abandoned);
  assert.deepEqual(abandonedInitial, { status: "new", generation: 1 });
  assert.deepEqual(await register(abandoned), { status: "duplicate" });

  await pool.query(
    `UPDATE billing_webhook_events
     SET created_at=now() - interval '6 minutes'
     WHERE stripe_event_id=$1`,
    [abandoned.id],
  );

  const abandonedRetries = await Promise.all([register(abandoned), register(abandoned)]);
  const abandonedRetry = abandonedRetries.find((entry) => entry.status === "retry");
  assert.ok(abandonedRetry);
  assert.equal(abandonedRetry.generation, 2);
  assert.equal(abandonedRetries.filter((entry) => entry.status === "duplicate").length, 1);

  const abandonedClaim = await pool.query(
    `SELECT processed_at, processing_error, retry_started_at
     FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [abandoned.id],
  );
  assert.equal(abandonedClaim.rows[0].processed_at, null);
  assert.equal(abandonedClaim.rows[0].processing_error, null);
  assert.ok(abandonedClaim.rows[0].retry_started_at);

  // The crashed generation-1 worker is fenced out after generation 2 claims.
  assert.equal(await markProcessed(abandoned.id, abandonedInitial.generation), false);
  assert.equal(await markFailed(abandoned.id, abandonedInitial.generation, "late crash report"), false);
  assert.equal(await markProcessed(abandoned.id, abandonedRetry.generation), true);
  assert.deepEqual(await register(abandoned), { status: "duplicate" });

  const persisted = await pool.query(
    `SELECT event_type, livemode, payload_hash FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [base.id],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].event_type, base.type);
  assert.equal(persisted.rows[0].livemode, base.livemode);
  assert.equal(persisted.rows[0].payload_hash, hash(base.rawPayload));

  console.log("Stripe event idempotency, retry recovery and processing-generation fencing regression checks passed");
} finally {
  await pool.end();
}
