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
  writeFileSync(firstLaunchPath, JSON.stringify(verified) + "\n", { mode: 0o600 });
  assert.equal(run(validator, [firstLaunchPath]).status, 0, "Verified first launch must pass");
  const upgradePath = join(directory, "verified-upgrade.json");
  const upgrade = {
    ...verified,
    firstLaunch: false,
    rollbackDeploymentId: "railway_previous_456",
    rollbackVerified: true,
  };
  writeFileSync(upgradePath, JSON.stringify(upgrade) + "\n", { mode: 0o600 });
  assert.equal(run(validator, [upgradePath]).status, 0, "Verified upgrade with distinct rollback must pass");
  const noRollbackPath = join(directory, "upgrade-without-rollback.json");
  writeFileSync(noRollbackPath, JSON.stringify({ ...upgrade, rollbackVerified: false }) + "\n", { mode: 0o600 });
  assert.equal(run(validator, [noRollbackPath]).status, 1, "Upgrade without verified rollback must fail closed");
  // A verified-looking record must still fail if any mandatory release gate is missing.
  for (const gate of [
    "ciPassed", "stagedChangesReviewed", "preflightPassed",
    "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
    "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
  ]) {
    const incomplete = { ...verified };
    delete incomplete[gate];
    const incompletePath = join(directory, `missing-${gate}.json`);
    writeFileSync(incompletePath, JSON.stringify(incomplete) + "\n", { mode: 0o600 });
    assert.equal(run(validator, [incompletePath]).status, 1, `Missing ${gate} must fail closed`);
  }
  // A release gate explicitly marked false must fail just like an omitted gate.
  // Exercise the CLI and file parser, not only the validator's in-memory self-test.
  for (const gate of [
    "ciPassed", "stagedChangesReviewed", "preflightPassed",
    "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
    "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
  ]) {
    const failedPath = join(directory, `failed-${gate}.json`);
    writeFileSync(failedPath, JSON.stringify({ ...verified, [gate]: false }) + "\n", { mode: 0o600 });
    assert.equal(run(validator, [failedPath]).status, 1, `Failed ${gate} must block release`);
  }
  // JSON truthy values must never impersonate explicit operator approval.
  for (const [label, overrides] of [
    ["string-gate", { oidcVerified: "true" }],
    ["numeric-gate", { smokePassed: 1 }],
    ["null-gate", { backupVerified: null }],
    ["string-launch-mode", { firstLaunch: "true" }],
    ["string-rollback-approval", { firstLaunch: false, rollbackDeploymentId: "railway_previous_456", rollbackVerified: "true" }],
  ]) {
    const invalidPath = join(directory, `spoofed-${label}.json`);
    writeFileSync(invalidPath, JSON.stringify({ ...verified, ...overrides }) + "\n", { mode: 0o600 });
    assert.equal(run(validator, [invalidPath]).status, 1, `${label} must not approve a release`);
  }
  // Exercise release identity and CI provenance checks through the on-disk CLI.
  // A passing set of operator gates cannot compensate for an invalid commit or CI URL.
  for (const [label, overrides] of [
    ["zero-commit", { commitSha: "0".repeat(40) }],
    ["short-commit", { commitSha: "a".repeat(39) }],
    ["foreign-ci", { ciRunUrl: "https://github.com/other/repo/actions/runs/123" }],
    ["ci-query", { ciRunUrl: verified.ciRunUrl + "?attempt=2" }],
    ["ci-fragment", { ciRunUrl: verified.ciRunUrl + "#logs" }],
    ["ci-trailing-slash", { ciRunUrl: verified.ciRunUrl + "/" }],
    ["ci-leading-zero", { ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/0123" }],
    ["ci-zero", { ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/0" }],
    ["ci-unsafe-integer", { ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/9007199254740992" }],
  ]) {
    const invalidPath = join(directory, `invalid-provenance-${label}.json`);
    writeFileSync(invalidPath, JSON.stringify({ ...verified, ...overrides }) + "\n", { mode: 0o600 });
    assert.equal(run(validator, [invalidPath]).status, 1, `Invalid release provenance (${label}) must fail closed`);
  }
  // Ambiguous duplicate keys must be rejected even when the final JSON value
  // would otherwise approve the release. Include escaped and nested keys.
  for (const [label, contents] of [
    ["top-level", JSON.stringify(verified).replace('"ciPassed":true', '"ciPassed":false,"ciPassed":true')],
    ["escaped", JSON.stringify(verified).replace('"ciPassed":true', '"ciPassed":false,"ci\\u0050assed":true')],
    ["nested", JSON.stringify({ ...verified, metadata: { source: "operator" } }).replace('"source":"operator"', '"source":"unreviewed","source":"operator"')],
  ]) {
    const ambiguousPath = join(directory, `duplicate-valid-${label}.json`);
    writeFileSync(ambiguousPath, contents + "\n", { mode: 0o600 });
    assert.equal(run(validator, [ambiguousPath]).status, 1, `Duplicate evidence keys (${label}) must fail closed`);
  }
  // Duplicate approval keys must also fail when whitespace separates tokens.
  // JSON permits this formatting, so it must not evade duplicate-key detection.
  const spacedDuplicatePath = join(directory, "duplicate-spaced-approval.json");
  const spacedDuplicate = JSON.stringify(verified).replace(
    '"ciPassed":true', '"ciPassed" : false,  "ciPassed" : true',
  );
  assert.notEqual(spacedDuplicate, JSON.stringify(verified), "Duplicate-key fixture must be constructed");
  writeFileSync(spacedDuplicatePath, spacedDuplicate + "\n", { mode: 0o600 });
  assert.equal(run(validator, [spacedDuplicatePath]).status, 1, "Whitespace-separated duplicate approval must fail closed");
  // Operator placeholders and zero IDs are not proof of a Railway deployment.
  // Exercise both current deployment and upgrade rollback evidence via the CLI.
  for (const [label, invalidId] of [
    ["placeholder", "placeholder"],
    ["todo", "TODO"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
    ["whitespace", "railway deployment"],
    ["oversized", "a".repeat(129)],
  ]) {
    for (const [role, evidence] of [
      ["current", { ...verified, railwayDeploymentId: invalidId }],
      ["rollback", { ...upgrade, rollbackDeploymentId: invalidId }],
    ]) {
      const invalidPath = join(directory, `invalid-railway-${role}-${label}.json`);
      writeFileSync(invalidPath, JSON.stringify(evidence) + "\n", { mode: 0o600 });
      assert.equal(run(validator, [invalidPath]).status, 1, `Invalid ${role} Railway ID (${label}) must fail closed`);
    }
  }
  const invalidFirstLaunchPath = join(directory, "first-launch-false-rollback-claim.json");
  writeFileSync(invalidFirstLaunchPath, JSON.stringify({ ...verified, rollbackVerified: true }) + "\n", { mode: 0o600 });
  assert.equal(run(validator, [invalidFirstLaunchPath]).status, 1, "First launch must not claim verified rollback");
  // First-launch records cannot imply a recoverable prior deployment, even if
  // every other release gate is approved. Exercise the on-disk CLI path.
  for (const [label, overrides] of [
    ["populated-rollback", { rollbackDeploymentId: "railway_previous_456" }],
    ["null-rollback", { rollbackDeploymentId: null }],
    ["rollback-approval-string", { rollbackVerified: "false" }],
    ["rollback-approval-null", { rollbackVerified: null }],
  ]) {
    const invalidPath = join(directory, `first-launch-invalid-${label}.json`);
    writeFileSync(invalidPath, JSON.stringify({ ...verified, ...overrides }) + "\\n", { mode: 0o600 });
    assert.equal(run(validator, [invalidPath]).status, 1, `First launch with ${label} must fail closed`);
  }
  for (const [label, overrides] of [
    ["missing-target", { rollbackDeploymentId: "" }],
    ["unverified", { rollbackVerified: false }],
    ["string-approval", { rollbackVerified: "true" }],
  ]) {
    const invalidPath = join(directory, `upgrade-invalid-${label}.json`);
    writeFileSync(invalidPath, JSON.stringify({ ...upgrade, ...overrides }) + "\\n", { mode: 0o600 });
    assert.equal(run(validator, [invalidPath]).status, 1, `Upgrade with ${label} must fail closed`);
  }
  const sameRollbackPath = join(directory, "upgrade-same-rollback.json");
  writeFileSync(sameRollbackPath, JSON.stringify({ ...upgrade, rollbackDeploymentId: upgrade.railwayDeploymentId }) + "\n", { mode: 0o600 });
  assert.equal(run(validator, [sameRollbackPath]).status, 1, "Upgrade must not roll back to its active deployment");
  // A UUID written in a different case or separator format is still the active deployment.
  // Verify the on-disk CLI gate, not only the validator's in-memory self-test.
  const activeUuid = "123e4567-e89b-12d3-a456-426614174000";
  for (const [label, rollbackId] of [
    ["compact", activeUuid.replace(/-/g, "")],
    ["uppercase", activeUuid.toUpperCase()],
    ["underscored", activeUuid.replace(/-/g, "_")],
    ["mixed", "123e4567_e89b-12d3_a456-426614174000"],
  ]) {
    const sameUuidPath = join(directory, `upgrade-same-uuid-${label}.json`);
    writeFileSync(sameUuidPath, JSON.stringify({
      ...upgrade, railwayDeploymentId: activeUuid, rollbackDeploymentId: rollbackId,
    }) + "\n", { mode: 0o600 });
    assert.equal(run(validator, [sameUuidPath]).status, 1, `Equivalent UUID rollback (${label}) must fail closed`);
  }
  console.log("Production release evidence draft regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
