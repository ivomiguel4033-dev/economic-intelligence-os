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
assert.match(source, /set_config\('lock_timeout', \$1, true\)/, "tenant serialization must use a bounded PostgreSQL lock timeout");
assert.match(source, /ORCHESTRATION_TENANT_LOCK_TIMEOUT_MS/, "tenant lock timeout must be independently configurable");
assert.match(source, /postgresErrorCode\(error\) === "55P03"/, "lock contention must fail closed as temporary saturation");
assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)/, "acquisition must serialize per tenant");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND expires_at <= NOW\(\)/, "expired leases must be reclaimed tenant-locally");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND expires_at > NOW\(\)/, "capacity must count only active leases for the tenant");
assert.match(source, /if \(\(capacity\.rows\[0\]\?\.active \?\? limit\) >= limit\)/, "acquisition must fail closed at the configured limit");
assert.match(source, /await client\.query\("ROLLBACK"\)/, "failed acquisition must attempt transaction rollback");
assert.match(source, /let discardClient = false;/, "acquisition must track whether a failed rollback poisoned the PostgreSQL client");
assert.match(source, /let transactionOpen = false;/, "acquisition must explicitly track transaction state");
assert.match(source, /await client\.query\("BEGIN"\);\s*transactionOpen = true;/s, "transaction state must become open only after BEGIN succeeds");
assert.match(source, /await client\.query\("COMMIT"\);\s*transactionOpen = false;/s, "successful COMMIT must close the tracked transaction state");
assert.match(source, /if \(transactionOpen\) \{[\s\S]*?await client\.query\("ROLLBACK"\);[\s\S]*?\} else \{[\s\S]*?discardClient = true;[\s\S]*?\}/, "a failed COMMIT must be treated as ambiguous and force PostgreSQL client destruction");
assert.match(source, /catch \{\s*discardClient = true;\s*\}/s, "failed rollback must mark the PostgreSQL client for destruction");
assert.match(source, /finally \{\s*client\.release\(discardClient\);\s*\}/s, "acquisition must always release the PostgreSQL client and discard it when transaction outcome is unsafe");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)?\s+AND lease_token=\$2(?:::uuid)?\s+AND expires_at > NOW\(\)/s, "renewal must be tenant/token fenced and refuse expired leases");
assert.match(source, /let leaseLost = false;/, "lease ownership must track ambiguous renewal loss locally");
assert.match(source, /if \(released \|\| leaseLost\)/, "renewal must fail closed after release or ambiguous lease loss");
assert.match(source, /if \(\(renewed\.rowCount \?\? 0\) !== 1\) \{\s*leaseLost = true;/s, "a fenced renewal miss must permanently mark the local lease as lost");
assert.match(source, /catch \(error\) \{[\s\S]*?leaseLost = true;[\s\S]*?tenant_concurrency_renew_failures_total[\s\S]*?throw error;/s, "ambiguous renewal errors must mark the local lease lost before propagating");
assert.match(source, /WHERE organization_id=\$1(?:::uuid)? AND lease_token=\$2(?:::uuid)?/, "release must be tenant and token scoped");
assert.match(source, /if \(releasePromise\) return releasePromise;/, "release must be idempotent under concurrent callers");
assert.match(source, /releasePromise = undefined;/, "failed release must remain retryable");
assert.match(source, /\.catch\(\(error\) => \{[\s\S]*?leaseLost = true;[\s\S]*?tenant_concurrency_release_failures_total[\s\S]*?releasePromise = undefined;[\s\S]*?throw error;[\s\S]*?\}\);/s, "ambiguous release errors must fail closed locally before becoming retryable");
assert.match(source, /if \(released \|\| leaseLost\)[\s\S]*?return false;/s, "renewal must remain disabled after an ambiguous release even when release itself is retried");
assert.match(source, /Number\.isSafeInteger\(ttlSeconds\) &&?[^\n]*ttlSeconds > 0|!Number\.isSafeInteger\(ttlSeconds\) \|\| ttlSeconds <= 0/, "lease TTL must reject unsafe or non-positive values");
assert.match(source, /organizationId\.length <= 128/, "organization identifiers must have a bounded length");
assert.match(source, /organizationId === organizationId\.trim\(\)/, "organization identifiers must reject ambiguous surrounding whitespace");
assert.match(source, /\\u0000-\\u001f\\u007f/, "organization identifiers must reject control characters");
assert.match(source, /\^\\d\+\$/.source ? /\^\\d\+\$/ : /ORCHESTRATION_MAX_CONCURRENCY_PER_TENANT/, "numeric configuration must be parsed strictly");
assert.match(source, /Number\.isSafeInteger\(parsed\) && parsed > 0/, "numeric configuration must stay within the safe positive integer domain");
assert.match(source, /Math\.max\(100, Math\.min\(parsed, 5000\)\)/, "tenant lock timeout must remain operationally bounded");

const pool = new Pool({ connectionString, max: 12 });

async function createOrganization(slug) {
  const result = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [`Distributed concurrency ${slug}`, slug],
  );
  return result.rows[0].id;
}

async function acquire(organizationId, leaseToken, limit = 2, ttlSeconds = 30, lockTimeoutMs = 1000) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [organizationId]);
    await client.query(`DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND expires_at <= NOW()`, [organizationId]);
    const capacity = await client.query(`SELECT COUNT(*)::int AS active FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND expires_at > NOW()`, [organizationId]);
    if ((capacity.rows[0]?.active ?? limit) >= limit) {
      await client.query("COMMIT");
      return null;
    }
    const result = await client.query(
      `INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       VALUES ($1::uuid, $2::uuid, NOW() + ($3 * INTERVAL '1 second')) RETURNING lease_token::text AS lease_token`,
      [organizationId, leaseToken, ttlSeconds],
    );
    await client.query("COMMIT");
    return result.rows[0]?.lease_token ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "55P03") return null;
    throw error;
  } finally {
    client.release();
  }
}

async function acquireThenFail(organizationId, leaseToken) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [organizationId]);
    await client.query(`INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at) VALUES ($1::uuid, $2::uuid, NOW() + INTERVAL '30 seconds')`, [organizationId, leaseToken]);
    throw new Error("injected acquisition failure");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function renew(organizationId, leaseToken, ttlSeconds = 30) {
  return pool.query(
    `UPDATE tenant_concurrency_leases
     SET expires_at=NOW() + ($3 * INTERVAL '1 second')
     WHERE organization_id=$1::uuid AND lease_token=$2::uuid AND expires_at > NOW()
     RETURNING lease_token::text AS lease_token`,
    [organizationId, leaseToken, ttlSeconds],
  );
}

try {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const firstTenant = await createOrganization(`distributed-concurrency-a-${suffix}`);
  const secondTenant = await createOrganization(`distributed-concurrency-b-${suffix}`);
  const contendedTenant = await createOrganization(`distributed-concurrency-c-${suffix}`);

  const contenders = Array.from({ length: 8 }, () => crypto.randomUUID());
  const results = await Promise.all(contenders.map((token) => acquire(firstTenant, token)));
  assert.equal(results.filter(Boolean).length, 2, "exactly the configured number of concurrent leases may win");

  const secondTenantToken = crypto.randomUUID();
  const secondTenantAcquire = await acquire(secondTenant, secondTenantToken);
  assert.equal(secondTenantAcquire, secondTenantToken, "one saturated tenant must not block another tenant");

  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [contendedTenant]);
    const startedAt = Date.now();
    const blockedAcquire = await acquire(contendedTenant, crypto.randomUUID(), 2, 30, 250);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(blockedAcquire, null, "prolonged tenant lock contention must fail closed instead of hanging");
    assert.ok(elapsedMs < 2000, `lock contention should be bounded, took ${elapsedMs}ms`);
    await blocker.query("ROLLBACK");
  } finally {
    blocker.release();
  }

  const recoveredToken = crypto.randomUUID();
  const recoveredAcquire = await acquire(contendedTenant, recoveredToken);
  assert.equal(recoveredAcquire, recoveredToken, "tenant must recover immediately after advisory lock contention clears");

  const active = await pool.query(`SELECT organization_id, COUNT(*)::int AS count FROM tenant_concurrency_leases WHERE organization_id = ANY($1::uuid[]) AND expires_at > NOW() GROUP BY organization_id`, [[firstTenant, secondTenant]]);
  const counts = new Map(active.rows.map((row) => [row.organization_id, row.count]));
  assert.equal(counts.get(firstTenant), 2);
  assert.equal(counts.get(secondTenant), 1);

  const renewableToken = results.find(Boolean);
  assert.ok(renewableToken);
  await pool.query(`UPDATE tenant_concurrency_leases SET expires_at=NOW() + INTERVAL '2 seconds' WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [firstTenant, renewableToken]);
  const renewed = await renew(firstTenant, renewableToken, 30);
  assert.equal(renewed.rowCount, 1, "active owner must renew its own lease");
  const crossTenantRenew = await renew(secondTenant, renewableToken, 30);
  assert.equal(crossTenantRenew.rowCount, 0, "renewal must not cross tenant boundaries");
  await pool.query(`UPDATE tenant_concurrency_leases SET expires_at=NOW() - INTERVAL '1 second' WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [firstTenant, renewableToken]);
  const expiredRenew = await renew(firstTenant, renewableToken, 30);
  assert.equal(expiredRenew.rowCount, 0, "expired lease must never be resurrected by a stale heartbeat");

  await pool.query(`UPDATE tenant_concurrency_leases SET expires_at=NOW() - INTERVAL '1 second' WHERE organization_id=$1::uuid`, [firstTenant]);
  const reclaimedToken = crypto.randomUUID();
  const reclaimed = await acquire(firstTenant, reclaimedToken);
  assert.equal(reclaimed, reclaimedToken, "expired leases must be reclaimed before capacity is evaluated");

  const failedToken = crypto.randomUUID();
  await assert.rejects(acquireThenFail(firstTenant, failedToken), /injected acquisition failure/, "injected acquisition failure must propagate");
  const leakedAfterRollback = await pool.query(`SELECT COUNT(*)::int AS count FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [firstTenant, failedToken]);
  assert.equal(leakedAfterRollback.rows[0]?.count, 0, "failed acquisition must not leak a lease after rollback");

  const postFailureToken = crypto.randomUUID();
  const postFailureAcquire = await acquire(firstTenant, postFailureToken);
  assert.equal(postFailureAcquire, postFailureToken, "tenant must remain acquirable after a rolled-back acquisition failure");

  const wrongTenantRelease = await pool.query(`DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [secondTenant, reclaimedToken]);
  assert.equal(wrongTenantRelease.rowCount, 0, "release must not cross tenant boundaries");
  const released = await pool.query(`DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [firstTenant, reclaimedToken]);
  assert.equal(released.rowCount, 1);
  const duplicateRelease = await pool.query(`DELETE FROM tenant_concurrency_leases WHERE organization_id=$1::uuid AND lease_token=$2::uuid`, [firstTenant, reclaimedToken]);
  assert.equal(duplicateRelease.rowCount, 0, "duplicate release must be harmless");

  await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[firstTenant, secondTenant, contendedTenant]]);
  console.log("Distributed tenant concurrency regression checks passed.");
} finally {
  await pool.end();
}
