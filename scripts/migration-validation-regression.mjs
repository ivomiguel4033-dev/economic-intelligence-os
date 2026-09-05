import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "migration-validation-"));
const scriptsDir = join(root, "scripts");
const migrationsDir = join(root, "db", "migrations");
await mkdir(scriptsDir, { recursive: true });
await mkdir(migrationsDir, { recursive: true });
await cp(new URL("./validate-migrations.mjs", import.meta.url), join(scriptsDir, "validate-migrations.mjs"));

function validate(files) {
  for (const file of files) {
    writeFile(join(migrationsDir, file), "-- regression fixture\n");
  }
  const result = spawnSync(process.execPath, [join(scriptsDir, "validate-migrations.mjs")], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function reset() {
  await rm(migrationsDir, { recursive: true, force: true });
  await mkdir(migrationsDir, { recursive: true });
}

try {
  let result = validate(["001_create_tenants.sql", "002_add_outbox.sql"]);
  assert(result.status === 0, `Canonical migrations should pass: ${result.output}`);

  await reset();
  result = validate(["001_create_tenants.sql", "003_add_outbox.sql"]);
  assert(result.status !== 0 && /contiguous/.test(result.output), "Migration gaps must fail closed");

  await reset();
  result = validate(["000_create_tenants.sql"]);
  assert(result.status !== 0 && /start at 001/.test(result.output), "Migration numbering at 000 must fail closed");

  await reset();
  result = validate(["001_Create-Tenants.sql"]);
  assert(result.status !== 0 && /NNN_snake_case/.test(result.output), "Non-canonical migration names must fail closed");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Migration filename and sequence regression checks passed");
