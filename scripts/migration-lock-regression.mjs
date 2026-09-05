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

function runMigration({ allowChecksumBaseline = false, checksumBaselineFiles = [] } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DATABASE_URL: connectionString };
    delete env.ALLOW_MIGRATION_CHECKSUM_BASELINE;
    delete env.MIGRATION_CHECKSUM_BASELINE_FILES;
    if (allowChecksumBaseline) env.ALLOW_MIGRATION_CHECKSUM_BASELINE = "true";
    if (checksumBaselineFiles.length > 0) {
      env.MIGRATION_CHECKSUM_BASELINE_FILES = checksumBaselineFiles.join(",");
    }

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
  assert.equal(afterRelease.code, 0, `migration runner must recover after lock release: ${afterRelease.stderr}`);

  const missingFilename = "000_missing_source_regression.sql";
  await holder.query(
    "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
    [missingFilename, "0".repeat(64)],
  );
  const missingSource = await runMigration();
  assert.notEqual(missingSource.code, 0, "applied migration missing from source tree must fail closed");
  assert.match(
    `${missingSource.stdout}\n${missingSource.stderr}`,
    /Applied migrations are missing from source tree: 000_missing_source_regression\.sql/,
    "runner must identify the applied migration whose source file is missing",
  );
  const missingRow = await holder.query(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    [missingFilename],
  );
  assert.equal(missingRow.rows[0]?.checksum, "0".repeat(64), "missing-source rejection must not mutate migration history");
  await holder.query("DELETE FROM schema_migrations WHERE filename = $1", [missingFilename]);

  const afterMissingSourceCleanup = await runMigration();
  assert.equal(afterMissingSourceCleanup.code, 0, `migration runner must recover after missing-source history is repaired: ${afterMissingSourceCleanup.stderr}`);

  const staleKnownBaseline = await runMigration({ allowChecksumBaseline: true, checksumBaselineFiles: ["002_ai_board.sql"] });
  assert.notEqual(staleKnownBaseline.code, 0, "baseline authorization for an already-checksummed migration must fail closed");
  assert.match(`${staleKnownBaseline.stdout}\n${staleKnownBaseline.stderr}`, /Checksum baseline authorization was not consumed for migrations: 002_ai_board\.sql/);

  const applied = await holder.query("SELECT checksum FROM schema_migrations WHERE filename = $1", ["001_core.sql"]);
  originalChecksum = applied.rows[0]?.checksum ?? null;
  assert.match(originalChecksum ?? "", /^[a-f0-9]{64}$/, "applied migrations must record a SHA-256 checksum");

  await holder.query("UPDATE schema_migrations SET checksum = NULL WHERE filename = $1", ["001_core.sql"]);

  const implicitBaseline = await runMigration();
  assert.notEqual(implicitBaseline.code, 0, "historical migration without checksum must fail without explicit baseline authorization");
  assert.match(`${implicitBaseline.stdout}\n${implicitBaseline.stderr}`, /Migration 001_core\.sql has no checksum baseline/);

  const broadBaseline = await runMigration({ allowChecksumBaseline: true });
  assert.notEqual(broadBaseline.code, 0, "baseline authorization without an explicit migration allowlist must fail closed");
  assert.match(`${broadBaseline.stdout}\n${broadBaseline.stderr}`, /MIGRATION_CHECKSUM_BASELINE_FILES must explicitly list migrations/);

  const mixedBaseline = await runMigration({ allowChecksumBaseline: true, checksumBaselineFiles: ["001_core.sql", "002_ai_board.sql"] });
  assert.notEqual(mixedBaseline.code, 0, "mixed required and stale baseline grants must fail before any adoption");
  assert.match(`${mixedBaseline.stdout}\n${mixedBaseline.stderr}`, /Checksum baseline authorization was not consumed for migrations: 002_ai_board\.sql/);
  const afterMixedBaseline = await holder.query("SELECT checksum FROM schema_migrations WHERE filename = $1", ["001_core.sql"]);
  assert.equal(afterMixedBaseline.rows[0]?.checksum ?? null, null, "preflight rejection must not partially baseline an otherwise authorized migration");

  const wrongBaseline = await runMigration({ allowChecksumBaseline: true, checksumBaselineFiles: ["999_not_the_target.sql"] });
  assert.notEqual(wrongBaseline.code, 0, "baseline authorization for an unknown migration must fail closed");
  assert.match(`${wrongBaseline.stdout}\n${wrongBaseline.stderr}`, /MIGRATION_CHECKSUM_BASELINE_FILES contains unknown migrations: 999_not_the_target\.sql/);

  const stillMissing = await holder.query("SELECT checksum FROM schema_migrations WHERE filename = $1", ["001_core.sql"]);
  assert.equal(stillMissing.rows[0]?.checksum ?? null, null, "failed baseline attempts must not mutate the migration checksum");

  const explicitBaseline = await runMigration({ allowChecksumBaseline: true, checksumBaselineFiles: ["001_core.sql"] });
  assert.equal(explicitBaseline.code, 0, `explicit checksum baseline adoption must succeed: ${explicitBaseline.stderr}`);
  assert.match(explicitBaseline.stdout, /Recorded checksum baseline for migration 001_core\.sql/);

  const baselined = await holder.query("SELECT checksum FROM schema_migrations WHERE filename = $1", ["001_core.sql"]);
  assert.equal(baselined.rows[0]?.checksum, originalChecksum, "explicit adoption must persist the current migration SHA-256 checksum");

  await holder.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", ["001_core.sql", "checksum-drift-regression"]);
  const drifted = await runMigration();
  assert.notEqual(drifted.code, 0, "migration checksum drift must fail closed");
  assert.match(`${drifted.stdout}\n${drifted.stderr}`, /Migration checksum mismatch for 001_core\.sql/);

  await holder.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", ["001_core.sql", originalChecksum]);
  const afterRestore = await runMigration();
  assert.equal(afterRestore.code, 0, `migration runner must recover after checksum restoration: ${afterRestore.stderr}`);

  console.log("Migration advisory lock, source integrity, and scoped checksum baseline regression checks passed");
} finally {
  try {
    await holder.query("DELETE FROM schema_migrations WHERE filename = $1", ["000_missing_source_regression.sql"]);
  } catch {
    // Best-effort cleanup only.
  }
  if (originalChecksum) {
    try {
      await holder.query("UPDATE schema_migrations SET checksum = $2 WHERE filename = $1", ["001_core.sql", originalChecksum]);
    } catch {
      // Best-effort cleanup only; the regression result remains authoritative.
    }
  }
  try {
    await holder.query("SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", [migrationLockKey]);
  } catch {
    // Connection cleanup releases any remaining session advisory lock.
  }
  await holder.end();
}
