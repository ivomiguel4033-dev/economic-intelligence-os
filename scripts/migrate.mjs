import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

function boundedIntegerEnv(name, defaultValue, minimum, maximum) {
  const configured = Number(process.env[name] ?? String(defaultValue));
  if (!Number.isSafeInteger(configured) || configured < minimum) return defaultValue;
  return Math.min(configured, maximum);
}

const migrationConnectionTimeoutMs = boundedIntegerEnv(
  "MIGRATION_CONNECTION_TIMEOUT_MS",
  10_000,
  250,
  60_000,
);
const migrationStatementTimeoutMs = boundedIntegerEnv(
  "MIGRATION_STATEMENT_TIMEOUT_MS",
  300_000,
  1_000,
  1_800_000,
);
const migrationQueryTimeoutMs = Math.min(migrationStatementTimeoutMs + 5_000, 1_805_000);
const migrationLockTimeoutMs = boundedIntegerEnv(
  "MIGRATION_LOCK_TIMEOUT_MS",
  30_000,
  250,
  120_000,
);

const client = new Client({
  connectionString,
  application_name: "economic-intelligence-os:migrate",
  connectionTimeoutMillis: migrationConnectionTimeoutMs,
  statement_timeout: migrationStatementTimeoutMs,
  query_timeout: migrationQueryTimeoutMs,
  lock_timeout: migrationLockTimeoutMs,
});
await client.connect();

const migrationLockKey = "economic-intelligence-os:schema-migrations:v1";
const allowChecksumBaseline = process.env.ALLOW_MIGRATION_CHECKSUM_BASELINE === "true";
const checksumBaselineFiles = new Set(
  (process.env.MIGRATION_CHECKSUM_BASELINE_FILES ?? "")
    .split(",")
    .map((filename) => filename.trim())
    .filter(Boolean),
);
if (allowChecksumBaseline && checksumBaselineFiles.size === 0) {
  throw new Error(
    "MIGRATION_CHECKSUM_BASELINE_FILES must explicitly list migrations when checksum baseline adoption is enabled",
  );
}
let migrationLockHeld = false;

try {
  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1::text, 0)) AS acquired",
    [migrationLockKey],
  );
  migrationLockHeld = lock.rows[0]?.acquired === true;
  if (!migrationLockHeld) {
    throw new Error("Another schema migration runner is already active");
  }

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    checksum text,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

  const directory = join(process.cwd(), "db", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const knownMigrations = new Set(files);
  const appliedMigrationRows = await client.query(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  const missingAppliedMigrationFiles = appliedMigrationRows.rows
    .map((row) => row.filename)
    .filter((filename) => !knownMigrations.has(filename));
  if (missingAppliedMigrationFiles.length > 0) {
    throw new Error(
      `Applied migrations are missing from source tree: ${missingAppliedMigrationFiles.join(", ")}`,
    );
  }

  if (allowChecksumBaseline) {
    const unknownBaselineFiles = [...checksumBaselineFiles].filter(
      (filename) => !knownMigrations.has(filename),
    );
    if (unknownBaselineFiles.length > 0) {
      throw new Error(
        `MIGRATION_CHECKSUM_BASELINE_FILES contains unknown migrations: ${unknownBaselineFiles.join(", ")}`,
      );
    }

    const missingChecksumRows = await client.query(
      "SELECT filename FROM schema_migrations WHERE checksum IS NULL ORDER BY filename",
    );
    const baselineTargets = new Set(
      missingChecksumRows.rows
        .map((row) => row.filename)
        .filter((filename) => knownMigrations.has(filename)),
    );
    const staleBaselineFiles = [...checksumBaselineFiles].filter(
      (filename) => !baselineTargets.has(filename),
    );
    if (staleBaselineFiles.length > 0) {
      throw new Error(
        `Checksum baseline authorization was not consumed for migrations: ${staleBaselineFiles.join(", ")}`,
      );
    }
    const unauthorizedBaselineTargets = [...baselineTargets].filter(
      (filename) => !checksumBaselineFiles.has(filename),
    );
    if (unauthorizedBaselineTargets.length > 0) {
      throw new Error(
        `Checksum baseline authorization is missing migrations that require adoption: ${unauthorizedBaselineTargets.join(", ")}`,
      );
    }
  }
  const adoptedChecksumBaselines = new Set();

  for (const filename of files) {
    const sql = await readFile(join(directory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query(
      "SELECT checksum FROM schema_migrations WHERE filename = $1",
      [filename],
    );

    if (existing.rowCount) {
      const appliedChecksum = existing.rows[0]?.checksum ?? null;
      if (appliedChecksum === null) {
        if (!allowChecksumBaseline || !checksumBaselineFiles.has(filename)) {
          throw new Error(
            `Migration ${filename} has no checksum baseline; controlled adoption requires ALLOW_MIGRATION_CHECKSUM_BASELINE=true and MIGRATION_CHECKSUM_BASELINE_FILES to explicitly include it`,
          );
        }
        const baseline = await client.query(
          "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL RETURNING filename",
          [filename, checksum],
        );
        if (baseline.rowCount !== 1) {
          throw new Error(`Failed to record checksum baseline for migration ${filename}`);
        }
        adoptedChecksumBaselines.add(filename);
        console.log(`Recorded checksum baseline for migration ${filename}`);
        continue;
      }
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${filename}`);
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(filename, checksum) VALUES($1, $2)",
        [filename, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied migration ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  if (allowChecksumBaseline) {
    const unusedBaselineFiles = [...checksumBaselineFiles].filter(
      (filename) => !adoptedChecksumBaselines.has(filename),
    );
    if (unusedBaselineFiles.length > 0) {
      throw new Error(
        `Checksum baseline authorization was not consumed for migrations: ${unusedBaselineFiles.join(", ")}`,
      );
    }
  }
} finally {
  if (migrationLockHeld) {
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1::text, 0))",
        [migrationLockKey],
      );
    } catch (error) {
      console.error("Failed to release schema migration advisory lock", error);
    }
  }
  await client.end();
}
