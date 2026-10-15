import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("./production-release-evidence-draft.mjs", import.meta.url));
const validator = fileURLToPath(new URL("./check-production-release-evidence.mjs", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "release-evidence-draft-"));
const path = join(directory, "evidence.json");

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, "Child process must execute");
  return result;
}

try {
  assert.equal(run(generator, ["--self-test"]).status, 0, "Generator self-test");
  assert.equal(run(generator, [path]).status, 0, "Create evidence draft");
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(record.firstLaunch, null, "Launch mode must require operator input");
  assert.equal(record.commitSha, "", "Commit must not be guessed");
  assert.equal(record.railwayDeploymentId, "", "Deployment must not be guessed");
  for (const gate of [
    "ciPassed", "stagedChangesReviewed", "preflightPassed",
    "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
    "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
  ]) assert.equal(record[gate], false, gate + " must default to NO-GO");
  assert.equal(run(validator, [path]).status, 1, "Unverified draft must fail validation");
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600, "Evidence file must be private");
  }
  const original = readFileSync(path, "utf8");
  assert.equal(run(generator, [path]).status, 1, "Existing evidence must not be overwritten");
  assert.equal(readFileSync(path, "utf8"), original, "Existing evidence must remain unchanged");
  assert.equal(run(generator, []).status, 2, "Missing path must show usage error");
  console.log("Production release evidence draft regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
