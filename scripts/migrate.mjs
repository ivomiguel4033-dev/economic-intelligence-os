import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = new Client({ connectionString });
await client.connect();

const migrationLockKey = "economic-intelligence-os:schema-migrations:v1";
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
        await client.query(
          "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL",
          [filename, checksum],
        );
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
