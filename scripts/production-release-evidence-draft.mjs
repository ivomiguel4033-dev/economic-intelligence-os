#!/usr/bin/env node
// Create a fail-closed evidence draft for an operator to complete after a release.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const requiredChecks = [
  "ciPassed", "stagedChangesReviewed", "preflightPassed",
  "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
  "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
];

function createDraft() {
  return {
    commitSha: "",
    ciRunUrl: "",
    railwayDeploymentId: "",
    firstLaunch: null,
    rollbackDeploymentId: "",
    rollbackVerified: false,
    ...Object.fromEntries(requiredChecks.map((name) => [name, false])),
  };
}

if (process.argv[2] === "--self-test" && process.argv.length === 3) {
  const draft = createDraft();
  assert.equal(draft.firstLaunch, null);
  assert.equal(draft.commitSha, "");
  assert.equal(draft.railwayDeploymentId, "");
  for (const check of requiredChecks) assert.equal(draft[check], false);
  console.log("Fail-closed production release evidence draft self-test passed");
} else if (process.argv.length !== 3 || process.argv[2].startsWith("-")) {
  console.error("Usage: node scripts/production-release-evidence-draft.mjs <new-evidence.json>");
  process.exitCode = 2;
} else {
  try {
    await writeFile(process.argv[2], JSON.stringify(createDraft(), null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log("Created NO-GO evidence draft. Verify each field against real production evidence.");
  } catch (error) {
    console.error("Could not create release evidence draft: " + error.message);
    process.exitCode = 1;
  }
}
