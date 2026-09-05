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
     SET owner_id=EXCLUDED.owner_id,
         acquired_at=NOW(),
         expires_at=EXCLUDED.expires_at,
         fencing_token=execution_leases.fencing_token + 1
     WHERE execution_leases.expires_at <= NOW()
     RETURNING owner_id, fencing_token::text AS fencing_token`,
    [organizationId, leaseKey, ownerId, ttlSeconds],
  );
  const row = result.rows[0];
  return row?.owner_id === ownerId ? { ownerId, fencingToken: row.fencing_token } : null;
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
  const winningLeases = acquisitions.filter(Boolean);
  assert.equal(winningLeases.length, 1);
  const firstFence = winningLeases[0];
  assert.equal(firstFence.fencingToken, "1");

  const activeLease = await pool.query(
    `SELECT owner_id, fencing_token::text AS fencing_token, expires_at > NOW() AS active
     FROM execution_leases
     WHERE organization_id=$1 AND lease_key=$2`,
    [organizationId, leaseKey],
  );
  assert.equal(activeLease.rowCount, 1);
  assert.equal(activeLease.rows[0].active, true);
  assert.equal(activeLease.rows[0].fencing_token, "1");

  assert.ok(await acquireLease(secondOrganizationId, leaseKey, "tenant-two-owner"));
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
  const takeoverFence = await acquireLease(organizationId, leaseKey, "takeover-owner");
  assert.ok(takeoverFence);
  assert.equal(takeoverFence.fencingToken, "2");

  const takeover = await pool.query(
    `SELECT owner_id, fencing_token::text AS fencing_token FROM execution_leases WHERE organization_id=$1 AND lease_key=$2`,
    [organizationId, leaseKey],
  );
  assert.equal(takeover.rows[0].owner_id, "takeover-owner");
  assert.equal(takeover.rows[0].fencing_token, "2");

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

  const staleWrite = await pool.query(
    `UPDATE execution_runs
     SET state='uncertain'
     WHERE id=$1 AND organization_id=$2 AND state='running'
       AND EXISTS (
         SELECT 1 FROM execution_leases l
         WHERE l.organization_id=$2 AND l.lease_key=$3 AND l.owner_id=$4
           AND l.fencing_token=$5::bigint AND l.expires_at > NOW()
       )
     RETURNING state`,
    [runId, organizationId, leaseKey, firstFence.ownerId, firstFence.fencingToken],
  );
  assert.equal(staleWrite.rowCount, 0);

  const currentOwnerWrite = await pool.query(
    `UPDATE execution_runs
     SET state='uncertain'
     WHERE id=$1 AND organization_id=$2 AND state='running'
       AND EXISTS (
         SELECT 1 FROM execution_leases l
         WHERE l.organization_id=$2 AND l.lease_key=$3 AND l.owner_id=$4
           AND l.fencing_token=$5::bigint AND l.expires_at > NOW()
       )
     RETURNING state`,
    [runId, organizationId, leaseKey, takeoverFence.ownerId, takeoverFence.fencingToken],
  );
  assert.equal(currentOwnerWrite.rowCount, 1);

  const stateAfterFence = await pool.query(`SELECT state FROM execution_runs WHERE id=$1`, [runId]);
  assert.equal(stateAfterFence.rows[0].state, "uncertain");

  const terminalRace = await Promise.all([
    pool.query(
      `UPDATE execution_runs SET state='succeeded' WHERE id=$1 AND organization_id=$2 AND state='uncertain' RETURNING state`,
      [runId, organizationId],
    ),
    pool.query(
      `UPDATE execution_runs SET state='failed' WHERE id=$1 AND organization_id=$2 AND state='uncertain' RETURNING state`,
      [runId, organizationId],
    ),
  ]);
  assert.equal(terminalRace.filter((result) => result.rowCount === 1).length, 1);

  const stateAfterRace = await pool.query(`SELECT state FROM execution_runs WHERE id=$1`, [runId]);
  assert.ok(["succeeded", "failed"].includes(stateAfterRace.rows[0].state));

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
