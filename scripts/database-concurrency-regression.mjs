import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 12 });

async function createOrganization(slug) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Concurrency ${slug}`, slug],
  );
  return result.rows[0].id;
}

async function acquireLease(leaseKey, ownerId, ttlSeconds = 30) {
  const result = await pool.query(
    `INSERT INTO execution_leases (lease_key, owner_id, expires_at)
     VALUES ($1,$2,NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (lease_key) DO UPDATE
     SET owner_id=EXCLUDED.owner_id, acquired_at=NOW(), expires_at=EXCLUDED.expires_at
     WHERE execution_leases.expires_at <= NOW()
     RETURNING owner_id`,
    [leaseKey, ownerId, ttlSeconds],
  );
  return result.rows[0]?.owner_id === ownerId;
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organizationId = await createOrganization(`db-regression-${suffix}`);

  // Idempotency must be an atomic winner-takes-all write under contention.
  const idempotencyKey = `db-regression:${suffix}`;
  const inserts = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      pool.query(
        `INSERT INTO execution_idempotency (idempotency_key, organization_id, action_id, result)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [idempotencyKey, organizationId, "concurrency-test", JSON.stringify({ winner: index })],
      ),
    ),
  );
  assert.equal(inserts.filter((result) => result.rowCount === 1).length, 1);
  const persisted = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_idempotency WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  assert.equal(persisted.rows[0].count, 1);

  // A distributed lease must have exactly one owner while unexpired.
  const leaseKey = `db-regression:${suffix}`;
  const contenders = Array.from({ length: 10 }, (_, index) => `owner-${index}`);
  const acquisitions = await Promise.all(contenders.map((owner) => acquireLease(leaseKey, owner)));
  assert.equal(acquisitions.filter(Boolean).length, 1);

  const activeLease = await pool.query(
    `SELECT owner_id, expires_at > NOW() AS active FROM execution_leases WHERE lease_key=$1`,
    [leaseKey],
  );
  assert.equal(activeLease.rowCount, 1);
  assert.equal(activeLease.rows[0].active, true);

  // Expired leases must be recoverable by another worker while preserving
  // the invariant that expiry is always strictly after acquisition time.
  await pool.query(
    `UPDATE execution_leases
     SET acquired_at=NOW() - INTERVAL '2 seconds', expires_at=NOW() - INTERVAL '1 second'
     WHERE lease_key=$1`,
    [leaseKey],
  );
  assert.equal(await acquireLease(leaseKey, "takeover-owner"), true);
  const takeover = await pool.query(`SELECT owner_id FROM execution_leases WHERE lease_key=$1`, [leaseKey]);
  assert.equal(takeover.rows[0].owner_id, "takeover-owner");

  // Tenant deletion must clean execution reliability state through FK cascades.
  await pool.query(`DELETE FROM organizations WHERE id=$1`, [organizationId]);
  const afterDelete = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_idempotency WHERE organization_id=$1`,
    [organizationId],
  );
  assert.equal(afterDelete.rows[0].count, 0);

  await pool.query(`DELETE FROM execution_leases WHERE lease_key=$1`, [leaseKey]);
  console.log("Database concurrency regression checks passed.");
} finally {
  await pool.end();
}
