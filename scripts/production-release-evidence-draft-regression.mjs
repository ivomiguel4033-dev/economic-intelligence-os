import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  assert.equal(run(validator, ["--self-test"]).status, 0, "Validator self-test");
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
  // Malformed and ambiguous JSON must never satisfy the release evidence gate.
  for (const [name, contents] of [
    ["empty-evidence.json", ""],
    ["malformed-evidence.json", "{\"ciPassed\":"],
    ["duplicate-evidence.json", '{"ciPassed":false,"ciPassed":true}'],
    ["oversized-evidence.json", " ".repeat(65537)],
    ["utf8-bom-evidence.json", "\uFEFF{}"],
  ]) {
    const invalidPath = join(directory, name);
    writeFileSync(invalidPath, contents, { mode: 0o600 });
    assert.equal(run(validator, [invalidPath]).status, 1, `${name} must fail closed`);
  }
  // Invalid UTF-8 must not be silently replaced by the JSON parser.
  const invalidUtf8 = join(directory, "invalid-utf8-evidence.json");
  writeFileSync(invalidUtf8, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
  assert.equal(run(validator, [invalidUtf8]).status, 1, "Invalid UTF-8 evidence must fail closed");
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600, "Evidence file must be private");
    const writableEvidence = join(directory, "group-writable-evidence.json");
    writeFileSync(writableEvidence, draftText, { mode: 0o666 });
    // chmod explicitly so the regression does not depend on the runner umask.
    chmodSync(writableEvidence, 0o666);
    assert.equal(run(validator, [writableEvidence]).status, 1, "Group/world-writable evidence must fail closed");
  }
  const original = readFileSync(path, "utf8");
  assert.equal(run(generator, [path]).status, 1, "Existing evidence must not be overwritten");
  assert.equal(readFileSync(path, "utf8"), original, "Existing evidence must remain unchanged");
  assert.equal(run(generator, []).status, 2, "Missing path must show usage error");
  assert.equal(run(generator, ["--unknown"]).status, 2, "Unknown options must be rejected");
  assert.equal(run(generator, ["--self-test", path]).status, 2, "Extra arguments must not bypass generator usage validation");
  assert.equal(run(generator, [path, "--self-test"]).status, 2, "Trailing self-test flag must not bypass generator usage validation");
  assert.equal(run(generator, [join(directory, "unexpected.json"), "extra"]).status, 2, "Extra arguments must be rejected");
  if (process.platform !== "win32") {
    const target = join(directory, "existing-target.json");
    const link = join(directory, "evidence-link.json");
    writeFileSync(target, "sentinel\n");
    symlinkSync(target, link);
    assert.equal(run(generator, [link]).status, 1, "Existing symlink must not be overwritten");
    assert.equal(readFileSync(target, "utf8"), "sentinel\n", "Symlink target must remain unchanged");
    assert.equal(run(validator, [link]).status, 1, "Validator must reject symlinked evidence");
    const hardlink = join(directory, "evidence-hardlink.json");
    linkSync(path, hardlink);
    assert.equal(run(validator, [path]).status, 1, "Validator must reject evidence with multiple hard links");
    assert.equal(run(validator, [hardlink]).status, 1, "Validator must reject alternate hard-link evidence paths");
    rmSync(hardlink);
    assert.equal(run(validator, [path]).status, 1, "Original unverified evidence must still fail closed after removing hard link");
    const dangling = join(directory, "dangling-link.json");
    symlinkSync(join(directory, "missing-target.json"), dangling);
    assert.equal(run(generator, [dangling]).status, 1, "Dangling symlink must not be replaced");
    assert.equal(run(generator, [directory]).status, 1, "Directory must not be replaced by evidence");
    assert.equal(run(validator, [directory]).status, 1, "Directory must not be accepted as release evidence");
    assert.equal(statSync(directory).isDirectory(), true, "Evidence generator must preserve the directory");
    const nested = join(directory, "missing-parent", "evidence.json");
    assert.equal(run(generator, [nested]).status, 1, "Missing parent directory must fail safely");
    assert.equal(existsSync(nested), false, "Failed generation must not create partial evidence");
    const fileParent = join(directory, "not-a-directory");
    writeFileSync(fileParent, "sentinel\\n");
    const impossibleChild = join(fileParent, "evidence.json");
    assert.equal(run(generator, [impossibleChild]).status, 1, "File parent must reject evidence creation");
    assert.equal(readFileSync(fileParent, "utf8"), "sentinel\\n", "Failed generation must preserve parent file");
  }
  // Exercise the actual release gate end-to-end for both first deployment and upgrade.
  // A fully reviewed first launch has no previous deployment to roll back to.
  const verified = {
    ...record,
    commitSha: "a".repeat(40),
    ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
    railwayDeploymentId: "railway_current_123",
    firstLaunch: true,
    ...Object.fromEntries([
      "ciPassed", "stagedChangesReviewed", "preflightPassed",
      "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
      "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
    ].map((gate) => [gate, true])),
  };
  const firstLaunchPath = join(directory, "verified-first-launch.json");
  writeFileSync(firstLaunchPath, JSON.stringify(verified) + "\\n", { mode: 0o600 });
  assert.equal(run(validator, [firstLaunchPath]).status, 0, "Verified first launch must pass");
  const upgradePath = join(directory, "verified-upgrade.json");
  const upgrade = {
    ...verified,
    firstLaunch: false,
    rollbackDeploymentId: "railway_previous_456",
    rollbackVerified: true,
  };
  writeFileSync(upgradePath, JSON.stringify(upgrade) + "\\n", { mode: 0o600 });
  assert.equal(run(validator, [upgradePath]).status, 0, "Verified upgrade with distinct rollback must pass");
  const noRollbackPath = join(directory, "upgrade-without-rollback.json");
  writeFileSync(noRollbackPath, JSON.stringify({ ...upgrade, rollbackVerified: false }) + "\\n", { mode: 0o600 });
  assert.equal(run(validator, [noRollbackPath]).status, 1, "Upgrade without verified rollback must fail closed");
  console.log("Production release evidence draft regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
