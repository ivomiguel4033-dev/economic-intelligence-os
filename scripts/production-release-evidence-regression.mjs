import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./check-production-release-evidence.mjs", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "release-evidence-test-"));
const checks = [
  "ciPassed", "stagedChangesReviewed", "preflightPassed", "oidcVerified",
  "aiVerified", "postgresReady", "backupVerified", "migrationReviewed",
  "smokePassed", "postReleaseObservationPassed",
];
const valid = {
  commitSha: "a".repeat(40),
  ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
  railwayDeploymentId: "candidate-deployment",
  firstLaunch: true,
  rollbackVerified: false,
  ...Object.fromEntries(checks.map((check) => [check, true])),
};
// A rejected evidence record counts as a negative test only when the validator
// reports its own controlled gate failure. A crash, timeout or CLI usage error
// must never make a fail-closed regression appear to pass.
function isExpectedValidationFailure(result) {
  return result.error === undefined && result.signal == null && result.status === 1 &&
    /^Release evidence gate FAILED: \S/m.test(String(result.stderr ?? ""));
}

let index = 0;
function check(record, expectedExit, message) {
  const path = join(directory, `evidence-${index++}.json`);
  writeFileSync(path, JSON.stringify(record));
  const result = spawnSync(process.execPath, [validator, path], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined, `${message}: validator process should execute`);
  if (expectedExit === 1) {
    assert.equal(isExpectedValidationFailure(result), true,
      `${message}: expected a controlled release evidence rejection, got ${result.stderr}`);
  } else {
    assert.equal(result.signal, null, `${message}: validator terminated by signal`);
    assert.equal(result.status, expectedExit, `${message}: ${result.stderr}`);
    assert.match(result.stdout, /Release evidence fields complete/,
      `${message}: expected successful evidence validation`);
  }
}

try {
  assert.equal(isExpectedValidationFailure({
    error: undefined, signal: null, status: 1, stderr: "Release evidence gate FAILED: invalid record\n",
  }), true, "Controlled validation failure must satisfy a negative regression");
  for (const outcome of [
    { status: 1, signal: null, stderr: "SyntaxError: unexpected token" },
    { status: 2, signal: null, stderr: "Usage: node validator" },
    { status: null, signal: "SIGTERM", stderr: "Release evidence gate FAILED: timeout" },
    { status: 1, signal: null, error: new Error("spawn failed"), stderr: "Release evidence gate FAILED: unavailable" },
    { status: 1, signal: null, stderr: "" },
  ]) {
    assert.equal(isExpectedValidationFailure(outcome), false,
      "A crash, usage error, signal, spawn failure or empty rejection must fail the regression harness");
  }
  check(valid, 0, "Complete first-launch evidence");
  for (const gate of checks) {
    check({ ...valid, [gate]: false }, 1, `Failed ${gate} gate`);
    const withoutGate = { ...valid };
    delete withoutGate[gate];
    check(withoutGate, 1, `Missing ${gate} gate`);
  }
  for (const gate of ["oidcVerified", "aiVerified", "smokePassed", "backupVerified"]) {
    for (const value of ["true", 1, {}, []]) {
      check({ ...valid, [gate]: value }, 1, `${gate} must be boolean true, not a truthy impostor`);
    }
  }
  check({ ...valid, commitSha: "abc" }, 1, "Short commit SHA");
  check({ ...valid, commitSha: "g".repeat(40) }, 1, "Non-hex commit SHA");
  check({ ...valid, commitSha: "a".repeat(39) + " " }, 1, "Whitespace in commit SHA");
  check({ ...valid, ciRunUrl: valid.ciRunUrl + "?check=true" }, 1, "CI URL with query parameters");
  check({ ...valid, ciRunUrl: valid.ciRunUrl.replace("/123", "/") }, 1, "CI URL without run ID");
  for (const invalid of [null, 0, 1, "true", "false", {}]) {
    check({ ...valid, firstLaunch: invalid }, 1, "Non-boolean firstLaunch");
  }
  check({ ...valid, ciRunUrl: "https://example.org/actions/runs/123" }, 1, "Foreign CI URL");
  check({ ...valid, railwayDeploymentId: " " }, 1, "Blank deployment ID");
  check({ ...valid, rollbackDeploymentId: "previous" }, 1, "First launch with rollback target");
  check({ ...valid, firstLaunch: false }, 1, "Upgrade without rollback target");
  check({ ...valid, firstLaunch: false, rollbackDeploymentId: "previous" }, 1, "Upgrade without verified rollback capability");
  for (const invalid of [false, null, "true", 1]) {
    check({ ...valid, firstLaunch: false, rollbackDeploymentId: "previous", rollbackVerified: invalid }, 1, "Upgrade requires explicit rollback verification");
  }
  for (const invalid of [undefined, null, true, "false", "true", 0, 1, {}]) {
    check({ ...valid, rollbackVerified: invalid }, 1, "First launch requires explicit rollbackVerified=false");
  }
  check({ ...valid, firstLaunch: false, rollbackDeploymentId: "previous", rollbackVerified: true }, 0, "Upgrade with verified rollback target");
  check({ ...valid, firstLaunch: false, rollbackDeploymentId: "candidate-deployment" }, 1, "Upgrade cannot roll back to current deployment");
  check({ ...valid, firstLaunch: false, rollbackDeploymentId: " candidate-deployment " }, 1, "Rollback ID whitespace cannot bypass self-rollback rejection");
  // A transcription using underscores or mixed UUID separators is still the current deployment.
  const currentUuid = "123e4567-e89b-12d3-a456-426614174000";
  const compactUuid = "123e4567e89b12d3a456426614174000";
  check({ ...valid, firstLaunch: false, railwayDeploymentId: currentUuid, rollbackDeploymentId: currentUuid.replace(/-/g, "_"), rollbackVerified: true }, 1, "Underscore UUID alias cannot masquerade as rollback");
  check({ ...valid, firstLaunch: false, railwayDeploymentId: compactUuid, rollbackDeploymentId: "123e4567_e89b-12d3_a456-426614174000", rollbackVerified: true }, 1, "Mixed UUID separators cannot masquerade as rollback");
  check({ ...valid, firstLaunch: false, railwayDeploymentId: currentUuid, rollbackDeploymentId: "123e4567-e89b-12d3-a456-426614174001", rollbackVerified: true }, 0, "Distinct UUID rollback target remains valid");
  const missingArgument = spawnSync(process.execPath, [validator], { encoding: "utf8", timeout: 5000 });
  assert.equal(missingArgument.status, 2, "Missing CLI argument must exit with usage error");
  // A mistyped operator invocation must not report a passing self-test while
  // silently ignoring the supplied release evidence path.
  const selfTestWithEvidence = spawnSync(process.execPath, [
    validator, "--self-test", join(directory, "missing-evidence.json"),
  ], { encoding: "utf8", timeout: 5000 });
  assert.equal(selfTestWithEvidence.error, undefined, "Extra-argument regression must execute");
  assert.equal(selfTestWithEvidence.status, 2,
    "Self-test with an evidence path must fail with a usage error");
  assert.match(selfTestWithEvidence.stderr, /Usage: node scripts\/check-production-release-evidence\.mjs/,
    "Extra-argument invocation must not be reported as a successful self-test");
  assert.doesNotMatch(selfTestWithEvidence.stdout, /self-test passed/i,
    "Extra-argument invocation must not claim validation success");
  console.log("Production release evidence CLI regression checks passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
