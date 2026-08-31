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
    `SELECT event_type, livemode, payload_hash
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
  return "duplicate";
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

  const persisted = await pool.query(
    `SELECT event_type, livemode, payload_hash FROM billing_webhook_events WHERE stripe_event_id=$1`,
    [base.id],
  );
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].event_type, base.type);
  assert.equal(persisted.rows[0].livemode, base.livemode);
  assert.equal(persisted.rows[0].payload_hash, hash(base.rawPayload));

  console.log("Stripe event idempotency regression checks passed");
} finally {
  await pool.end();
}
