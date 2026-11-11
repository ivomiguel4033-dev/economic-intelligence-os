import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "migration-validation-"));
const scriptsDir = join(root, "scripts");
const migrationsDir = join(root, "db", "migrations");
await mkdir(scriptsDir, { recursive: true });
await mkdir(migrationsDir, { recursive: true });
await cp(new URL("./validate-migrations.mjs", import.meta.url), join(scriptsDir, "validate-migrations.mjs"));

async function validate(files) {
  await Promise.all(
    files.map((file) => writeFile(join(migrationsDir, file), "-- regression fixture\n")),
  );
  const result = spawnSync(process.execPath, [join(scriptsDir, "validate-migrations.mjs")], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function reset() {
  await rm(migrationsDir, { recursive: true, force: true });
  await mkdir(migrationsDir, { recursive: true });
}

try {
  // Invalid baseline flags must fail locally, without attempting PostgreSQL.
  // Port 1 is intentionally unreachable; a connection error would mask
  // the configuration problem during an actual Railway outage.
  const invalidBaseline = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./migrate.mjs", import.meta.url))],
    {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://app:secret@127.0.0.1:1/unreachable",
        ALLOW_MIGRATION_CHECKSUM_BASELINE: "true",
        MIGRATION_CHECKSUM_BASELINE_FILES: "",
      },
    },
  );
  assert(invalidBaseline.error === undefined, "Invalid baseline preflight must exit without timing out");
  assert(
    invalidBaseline.status !== 0 &&
      /MIGRATION_CHECKSUM_BASELINE_FILES must explicitly list migrations/.test(
        invalidBaseline.stdout + invalidBaseline.stderr,
      ),
    "Invalid checksum baseline must fail before attempting a PostgreSQL connection",
  );

  let result = await validate(["001_create_tenants.sql", "002_add_outbox.sql"]);
  assert(result.status === 0, `Canonical migrations should pass: ${result.output}`);

  await reset();
  result = await validate(["001_create_tenants.sql", "003_add_outbox.sql"]);
  assert(result.status !== 0 && /contiguous/.test(result.output), "Migration gaps must fail closed");

  await reset();
  result = await validate(["000_create_tenants.sql"]);
  assert(result.status !== 0 && /start at 001/.test(result.output), "Migration numbering at 000 must fail closed");

  await reset();
  result = await validate(["001_Create-Tenants.sql"]);
  assert(result.status !== 0 && /NNN_snake_case/.test(result.output), "Non-canonical migration names must fail closed");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Migration filename and sequence regression checks passed");
