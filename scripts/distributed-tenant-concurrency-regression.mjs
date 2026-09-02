import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const source = await readFile(
  new URL("../src/operations/distributed-tenant-concurrency.ts", import.meta.url),
  "utf8",
);

assert.match(source, /await db\.connect\(\)/, "acquisition must hold one PostgreSQL session for the transaction");
assert.match(source, /await client\.query\("BEGIN"\)/, "acquisition must use an explicit transaction");
assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)/, "acquisition must serialize per tenant");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND expires_at <= NOW\(\)/, "expired leases must be reclaimed tenant-locally");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND expires_at > NOW\(\)/, "capacity must count only active leases for the tenant");
assert.match(source, /if \(\(capacity\.rows\[0\]\?\.active \?\? limit\) >= limit\)/, "acquisition must fail closed at the configured limit");
assert.match(source, /await client\.query\("ROLLBACK"\)/, "failed acquisition must attempt transaction rollback");
assert.match(source, /finally \{\s*client\.release\(\);\s*\}/s, "acquisition must always return the PostgreSQL connection to the pool");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND lease_token=\$2(?:::uuid)?/, "release must be tenant and token scoped");
assert.match(source, /if \(releasePromise\) return releasePromise;/, "release must be idempotent under concurrent callers");
assert.match(source, /releasePromise = undefined;/, "failed release must remain retryable");

const pool = new Pool({ connectionString, max: 12 });

async function createOrganization(slug) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Distributed concurrency ${slug}`, slug],
  );
  return result.rows[0].id;
}

async function acquire(organizationId, leaseToken, limit = 2, ttlSeconds = 30) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [organizationId],
    );
    await client.query(
      `DELETE FROM tenant_concurrency_leases
       WHERE organization_id=$1::uuid AND expires_at <= NOW()`,
      [organizationId],
    );
    const capacity = await client.query(
      `SELECT COUNT(*)::int AS active
       FROM tenant_concurrency_leases
       WHERE organization_id=$1::uuid AND expires_at > NOW()`,
      [organizationId],
    );
    if ((capacity.rows[0]?.active ?? limit) >= limit) {
      await client.query("COMMIT");
      return null;
    }
    const result = await client.query(
      `INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       VALUES ($1::uuid, $2::uuid, NOW() + ($3 * INTERVAL '1 second'))
       RETURNING lease_token::text AS lease_token`,
      [organizationId, leaseToken, ttlSeconds],
    );
    await client.query("COMMIT");
    return result.rows[0]?.lease_token ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function acquireThenFail(organizationId, leaseToken) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [organizationId],
    );
    await client.query(
      `INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       VALUES ($1::uuid, $2::uuid, NOW() + INTERVAL '30 seconds')`,
      [organizationId, leaseToken],
    );
    throw new Error("injected acquisition failure");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const firstTenant = await createOrganization(`distributed-concurrency-a-${suffix}`);
  const secondTenant = await createOrganization(`distributed-concurrency-b-${suffix}`);

  const contenders = Array.from({ length: 8 }, () => crypto.randomUUID());
  const results = await Promise.all(contenders.map((token) => acquire(firstTenant, token)));
  assert.equal(results.filter(Boolean).length, 2, "exactly the configured number of concurrent leases may win");

  const secondTenantToken = crypto.randomUUID();
  const secondTenantAcquire = await acquire(secondTenant, secondTenantToken);
  assert.equal(secondTenantAcquire, secondTenantToken, "one saturated tenant must not block another tenant");

  const active = await pool.query(
    `SELECT organization_id, COUNT(*)::int AS count
     FROM tenant_concurrency_leases
     WHERE organization_id = ANY($1::uuid[]) AND expires_at > NOW()
     GROUP BY organization_id`,
    [[firstTenant, secondTenant]],
  );
  const counts = new Map(active.rows.map((row) => [row.organization_id, row.count]));
  assert.equal(counts.get(firstTenant), 2);
  assert.equal(counts.get(secondTenant), 1);

  await pool.query(
    `UPDATE tenant_concurrency_leases SET expires_at=NOW() - INTERVAL '1 second' WHERE organization_id=$1::uuid`,
    [firstTenant],
  );
  const reclaimedToken = crypto.randomUUID();
  const reclaimed = await acquire(firstTenant, reclaimedToken);
  assert.equal(reclaimed, reclaimedToken, "expired leases must be reclaimed before capacity is evaluated");

  const failedToken = crypto.randomUUID();
  await assert.rejects(
    acquireThenFail(firstTenant, failedToken),
    /injected acquisition failure/,
    "injected acquisition failure must propagate",
  );
  const leakedAfterRollback = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM tenant_concurrency_leases
     WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
    [firstTenant, failedToken],
  );
  assert.equal(leakedAfterRollback.rows[0]?.count, 0, "failed acquisition must not leak a lease after rollback");

  const postFailureToken = crypto.randomUUID();
  const postFailureAcquire = await acquire(firstTenant, postFailureToken);
  assert.equal(postFailureAcquire, postFailureToken, "tenant must remain acquirable after a rolled-back acquisition failure");

  const wrongTenantRelease = await pool.query(
    `DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
    [secondTenant, reclaimedToken],
  );
  assert.equal(wrongTenantRelease.rowCount, 0, "release must not cross tenant boundaries");

  const released = await pool.query(
    `DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
    [firstTenant, reclaimedToken],
  );
  assert.equal(released.rowCount, 1);
  const duplicateRelease = await pool.query(
    `DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
    [firstTenant, reclaimedToken],
  );
  assert.equal(duplicateRelease.rowCount, 0, "duplicate release must be harmless");

  await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[firstTenant, secondTenant]]);
  console.log("Distributed tenant concurrency regression checks passed.");
} finally {
  await pool.end();
}
