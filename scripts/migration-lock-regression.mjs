import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const migrationLockKey = "economic-intelligence-os:schema-migrations:v1";
const holder = new Client({ connectionString });
await holder.connect();
let originalChecksum = null;

function runMigration({ allowChecksumBaseline = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DATABASE_URL: connectionString };
    delete env.ALLOW_MIGRATION_CHECKSUM_BASELINE;
    if (allowChecksumBaseline) env.ALLOW_MIGRATION_CHECKSUM_BASELINE = "true";

    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const acquired = await holder.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS acquired",
    [migrationLockKey],
  );
  assert.equal(acquired.rows[0]?.acquired, true, "test must acquire the migration lock");

  const blocked = await runMigration();
  assert.notEqual(blocked.code, 0, "concurrent migration runner must fail closed");
  assert.match(
    `${blocked.stdout}\n${blocked.stderr}`,
    /Another schema migration runner is already active/,
    "concurrent runner must report the migration lock conflict",
  );

  const unlocked = await holder.query(
    "SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS released",
    [migrationLockKey],
  );
  assert.equal(unlocked.rows[0]?.released, true, "test must release the migration lock");

  const afterRelease = await runMigration();
  assert.equal(
    afterRelease.code,
    0,
    `migration runner must recover after lock release: ${afterRelease.stderr}`,
  );

  const applied = await holder.query(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    ["001_core.sql"],
  );
  originalChecksum = applied.rows[0]?.checksum ?? null;
  assert.match(
    originalChecksum ?? "",
    /^[a-f0-9]{64}$/,
    "applied migrations must record a SHA-256 checksum",
  );

  await holder.query(
    "UPDATE schema_migrations SET checksum = NULL WHERE filename = $1",
    ["001_core.sql"],
  );

  const implicitBaseline = await runMigration();
  assert.notEqual(
    implicitBaseline.code,
    0,
    "historical migration without checksum must fail without explicit baseline authorization",
  );
  assert.match(
    `${implicitBaseline.stdout}\n${implicitBaseline.stderr}`,
    /Migration 001_core\.sql has no checksum baseline/,
    "runner must explain that controlled checksum baseline adoption is required",
  );

  const stillMissing = await holder.query(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    ["001_core.sql"],
  );
  assert.equal(
    stillMissing.rows[0]?.checksum ?? null,
    null,
    "failed implicit adoption must not mutate the migration checksum",
  );

  const explicitBaseline = await runMigration({ allowChecksumBaseline: true });
  assert.equal(
    explicitBaseline.code,
    0,
    `explicit checksum baseline adoption must succeed: ${explicitBaseline.stderr}`,
  );
  assert.match(
    explicitBaseline.stdout,
    /Recorded checksum baseline for migration 001_core\.sql/,
    "explicit adoption must report the baselined migration",
  );

  const baselined = await holder.query(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    ["001_core.sql"],
  );
  assert.equal(
    baselined.rows[0]?.checksum,
    originalChecksum,
    "explicit adoption must persist the current migration SHA-256 checksum",
  );

  await holder.query(
    "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1",
    ["001_core.sql", "checksum-drift-regression"],
  );

  const drifted = await runMigration();
  assert.notEqual(drifted.code, 0, "migration checksum drift must fail closed");
  assert.match(
    `${drifted.stdout}\n${drifted.stderr}`,
    /Migration checksum mismatch for 001_core\.sql/,
    "migration runner must identify the drifted migration",
  );

  await holder.query(
    "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1",
    ["001_core.sql", originalChecksum],
  );

  const afterRestore = await runMigration();
  assert.equal(
    afterRestore.code,
    0,
    `migration runner must recover after checksum restoration: ${afterRestore.stderr}`,
  );

  console.log("Migration advisory lock and checksum baseline regression checks passed");
} finally {
  if (originalChecksum) {
    try {
      await holder.query(
        "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1",
        ["001_core.sql", originalChecksum],
      );
    } catch {
      // Best-effort cleanup only; the regression result remains authoritative.
    }
  }
  try {
    await holder.query(
      "SELECT pg_advisory_unlock(hashtextextended($1::text, 0))",
      [migrationLockKey],
    );
  } catch {
    // Connection cleanup releases any remaining session advisory lock.
  }
  await holder.end();
}
