import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  const draftText = readFileSync(path, "utf8");
  assert.equal(draftText.endsWith("\n"), true, "Evidence draft must end with a newline");
  assert.deepEqual(Object.keys(record).sort(), [
    "commitSha", "ciRunUrl", "railwayDeploymentId", "firstLaunch",
    "rollbackDeploymentId", "rollbackVerified",
    "ciPassed", "stagedChangesReviewed", "preflightPassed",
    "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
    "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
  ].sort(), "Evidence draft must contain exactly the documented release gates");
  assert.equal(record.firstLaunch, null, "Launch mode must require operator input");
  assert.equal(record.commitSha, "", "Commit must not be guessed");
  assert.equal(record.ciRunUrl, "", "CI run URL must not be guessed");
  assert.equal(record.rollbackDeploymentId, "", "Rollback target must not be guessed");
  assert.equal(record.railwayDeploymentId, "", "Deployment must not be guessed");
  assert.equal(record.rollbackVerified, false, "Rollback verification must default to NO-GO");
  for (const gate of [
    "ciPassed", "stagedChangesReviewed", "preflightPassed",
    "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
    "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
  ]) assert.equal(record[gate], false, gate + " must default to NO-GO");
  assert.equal(run(validator, [path]).status, 1, "Unverified draft must fail validation");
  assert.equal(run(validator, []).status, 2, "Validator must reject missing evidence path");
  assert.equal(run(validator, ["--self-test", path]).status, 2, "Extra arguments must not bypass evidence validation");
  assert.equal(run(validator, [path, "--self-test"]).status, 2, "Trailing self-test flag must not bypass validation");
  assert.equal(run(validator, [join(directory, "missing-evidence.json")]).status, 1, "Missing evidence file must fail closed");
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600, "Evidence file must be private");
  }
  const original = readFileSync(path, "utf8");
  assert.equal(run(generator, [path]).status, 1, "Existing evidence must not be overwritten");
  assert.equal(readFileSync(path, "utf8"), original, "Existing evidence must remain unchanged");
  assert.equal(run(generator, []).status, 2, "Missing path must show usage error");
  assert.equal(run(generator, ["--unknown"]).status, 2, "Unknown options must be rejected");
  assert.equal(run(generator, [join(directory, "unexpected.json"), "extra"]).status, 2, "Extra arguments must be rejected");
  if (process.platform !== "win32") {
    const target = join(directory, "existing-target.json");
    const link = join(directory, "evidence-link.json");
    writeFileSync(target, "sentinel\n");
    symlinkSync(target, link);
    assert.equal(run(generator, [link]).status, 1, "Existing symlink must not be overwritten");
    assert.equal(readFileSync(target, "utf8"), "sentinel\n", "Symlink target must remain unchanged");
    const dangling = join(directory, "dangling-link.json");
    symlinkSync(join(directory, "missing-target.json"), dangling);
    assert.equal(run(generator, [dangling]).status, 1, "Dangling symlink must not be replaced");
    assert.equal(run(generator, [directory]).status, 1, "Directory must not be replaced by evidence");
    assert.equal(statSync(directory).isDirectory(), true, "Evidence generator must preserve the directory");
    const nested = join(directory, "missing-parent", "evidence.json");
    assert.equal(run(generator, [nested]).status, 1, "Missing parent directory must fail safely");
    assert.equal(existsSync(nested), false, "Failed generation must not create partial evidence");
  }
  console.log("Production release evidence draft regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
