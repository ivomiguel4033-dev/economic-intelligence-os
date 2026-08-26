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

async function acquireLease(organizationId, leaseKey, ownerId, ttlSeconds = 30) {
  const result = await pool.query(
    `INSERT INTO execution_leases (organization_id, lease_key, owner_id, expires_at)
     VALUES ($1,$2,$3,NOW() + ($4 * INTERVAL '1 second'))
     ON CONFLICT (organization_id, lease_key) DO UPDATE
     SET owner_id=EXCLUDED.owner_id, acquired_at=NOW(), expires_at=EXCLUDED.expires_at
     WHERE execution_leases.expires_at <= NOW()
     RETURNING owner_id`,
    [organizationId, leaseKey, ownerId, ttlSeconds],
  );
  return result.rows[0]?.owner_id === ownerId;
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organizationId = await createOrganization(`db-regression-${suffix}`);
  const secondOrganizationId = await createOrganization(`db-regression-second-${suffix}`);

  const idempotencyKey = `db-regression:${suffix}`;
  const inserts = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      pool.query(
        `INSERT INTO execution_idempotency (idempotency_key, organization_id, action_id, result)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [idempotencyKey, organizationId, "concurrency-test", JSON.stringify({ winner: index })],
      ),
    ),
  );
  assert.equal(inserts.filter((result) => result.rowCount === 1).length, 1);

  const secondTenantInsert = await pool.query(
    `INSERT INTO execution_idempotency (idempotency_key, organization_id, action_id, result)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [idempotencyKey, secondOrganizationId, "concurrency-test", JSON.stringify({ tenant: 2 })],
  );
  assert.equal(secondTenantInsert.rowCount, 1);

  const persisted = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_idempotency WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  assert.equal(persisted.rows[0].count, 2);

  const leaseKey = `db-regression:${suffix}`;
  const contenders = Array.from({ length: 10 }, (_, index) => `owner-${index}`);
  const acquisitions = await Promise.all(
    contenders.map((owner) => acquireLease(organizationId, leaseKey, owner)),
  );
  assert.equal(acquisitions.filter(Boolean).length, 1);

  const activeLease = await pool.query(
    `SELECT owner_id, expires_at > NOW() AS active
     FROM execution_leases
     WHERE organization_id=$1 AND lease_key=$2`,
    [organizationId, leaseKey],
  );
  assert.equal(activeLease.rowCount, 1);
  assert.equal(activeLease.rows[0].active, true);

  assert.equal(await acquireLease(secondOrganizationId, leaseKey, "tenant-two-owner"), true);
  const crossTenantLeaseCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_leases WHERE lease_key=$1`,
    [leaseKey],
  );
  assert.equal(crossTenantLeaseCount.rows[0].count, 2);

  await pool.query(
    `UPDATE execution_leases
     SET acquired_at=NOW() - INTERVAL '2 seconds', expires_at=NOW() - INTERVAL '1 second'
     WHERE organization_id=$1 AND lease_key=$2`,
    [organizationId, leaseKey],
  );
  assert.equal(await acquireLease(organizationId, leaseKey, "takeover-owner"), true);
  const takeover = await pool.query(
    `SELECT owner_id FROM execution_leases WHERE organization_id=$1 AND lease_key=$2`,
    [organizationId, leaseKey],
  );
  assert.equal(takeover.rows[0].owner_id, "takeover-owner");

  // State changes use compare-and-set semantics so stale workers cannot overwrite
  // a state they no longer own. Exactly one transition out of running may win.
  const run = await pool.query(
    `INSERT INTO execution_runs (organization_id, action_id, action_type, idempotency_key)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [organizationId, "state-race", "regression", `state-race:${suffix}`],
  );
  const runId = run.rows[0].id;
  const started = await pool.query(
    `UPDATE execution_runs SET state='running' WHERE id=$1 AND organization_id=$2 AND state='pending' RETURNING state`,
    [runId, organizationId],
  );
  assert.equal(started.rowCount, 1);

  const terminalRace = await Promise.all([
    pool.query(
      `UPDATE execution_runs SET state='succeeded' WHERE id=$1 AND organization_id=$2 AND state='running' RETURNING state`,
      [runId, organizationId],
    ),
    pool.query(
      `UPDATE execution_runs SET state='uncertain' WHERE id=$1 AND organization_id=$2 AND state='running' RETURNING state`,
      [runId, organizationId],
    ),
  ]);
  assert.equal(terminalRace.filter((result) => result.rowCount === 1).length, 1);

  const stateAfterRace = await pool.query(`SELECT state FROM execution_runs WHERE id=$1`, [runId]);
  assert.ok(["succeeded", "uncertain"].includes(stateAfterRace.rows[0].state));

  // The database-level transition guard must reject impossible jumps even if a
  // future code path bypasses the runtime helper.
  await assert.rejects(
    pool.query(
      `UPDATE execution_runs SET state='pending' WHERE id=$1 AND organization_id=$2`,
      [runId, organizationId],
    ),
    (error) => error?.code === "23514",
  );

  await pool.query(`DELETE FROM organizations WHERE id=$1`, [organizationId]);
  const firstTenantLeaseAfterDelete = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_leases WHERE organization_id=$1`,
    [organizationId],
  );
  assert.equal(firstTenantLeaseAfterDelete.rows[0].count, 0);

  await pool.query(`DELETE FROM organizations WHERE id=$1`, [secondOrganizationId]);
  const afterDelete = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_idempotency WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  assert.equal(afterDelete.rows[0].count, 0);
  const leasesAfterDelete = await pool.query(
    `SELECT COUNT(*)::int AS count FROM execution_leases WHERE lease_key=$1`,
    [leaseKey],
  );
  assert.equal(leasesAfterDelete.rows[0].count, 0);

  console.log("Database concurrency regression checks passed.");
} finally {
  await pool.end();
}
