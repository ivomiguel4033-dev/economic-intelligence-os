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
  ...Object.fromEntries(checks.map((check) => [check, true])),
};
let index = 0;
function check(record, expectedExit, message) {
  const path = join(directory, `evidence-${index++}.json`);
  writeFileSync(path, JSON.stringify(record));
  const result = spawnSync(process.execPath, [validator, path], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined, "Validator process should execute");
  assert.equal(result.status, expectedExit, `${message}: ${result.stderr}`);
}

try {
  check(valid, 0, "Complete first-launch evidence");
  for (const gate of checks) {
    check({ ...valid, [gate]: false }, 1, `Failed ${gate} gate`);
    const withoutGate = { ...valid };
    delete withoutGate[gate];
    check(withoutGate, 1, `Missing ${gate} gate`);
  }
  check({ ...valid, commitSha: "abc" }, 1, "Short commit SHA");
  check({ ...valid, ciRunUrl: "https://example.org/actions/runs/123" }, 1, "Foreign CI URL");
  check({ ...valid, railwayDeploymentId: " " }, 1, "Blank deployment ID");
  check({ ...valid, rollbackDeploymentId: "previous" }, 1, "First launch with rollback target");
  check({ ...valid, firstLaunch: false }, 1, "Upgrade without rollback target");
  check({ ...valid, firstLaunch: false, rollbackDeploymentId: "previous" }, 0, "Upgrade with rollback target");
  const missingArgument = spawnSync(process.execPath, [validator], { encoding: "utf8", timeout: 5000 });
  assert.equal(missingArgument.status, 2, "Missing CLI argument must exit with usage error");
  console.log("Production release evidence CLI regression checks passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
