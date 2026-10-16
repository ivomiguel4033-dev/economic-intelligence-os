#!/usr/bin/env node
// Validate the completeness of a post-deployment release evidence record.
// This is a documentation/evidence gate, not proof that an external service is healthy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const requiredChecks = [
  "ciPassed", "stagedChangesReviewed", "preflightPassed",
  "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
  "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
];

function verify(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Release evidence must be a JSON object");
  }
  if (!/^[a-f0-9]{40}$/i.test(record.commitSha ?? "")) {
    throw new Error("A full 40-character release commit SHA is required");
  }
  const expected = "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/";
  if (typeof record.ciRunUrl !== "string" ||
      !new RegExp("^" + expected.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&") + "[0-9]+$").test(record.ciRunUrl)) {
    throw new Error("CI evidence must link to a run in this repository");
  }
  for (const check of requiredChecks) {
    if (record[check] !== true) throw new Error("Missing or failed release gate: " + check);
  }
  if (typeof record.railwayDeploymentId !== "string" || !record.railwayDeploymentId.trim()) {
    throw new Error("Railway deployment ID is required");
  }
  if (typeof record.firstLaunch !== "boolean") {
    throw new Error("firstLaunch must be explicitly true or false");
  }
  if (record.firstLaunch === true) {
    if (record.rollbackDeploymentId !== undefined && record.rollbackDeploymentId !== "") {
      throw new Error("First launch cannot claim an existing rollback target");
    }
  } else if (typeof record.rollbackDeploymentId !== "string" || !record.rollbackDeploymentId.trim()) {
    throw new Error("Upgrades require a recorded rollback deployment ID");
  }
  if (record.firstLaunch === false && record.rollbackDeploymentId.trim() === record.railwayDeploymentId.trim()) {
    throw new Error("Rollback deployment must differ from the current Railway deployment");
  }
  return true;
}

if (process.argv[2] === "--self-test") {
  const valid = {
    commitSha: "a".repeat(40),
    ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
    railwayDeploymentId: "deployment-example",
    firstLaunch: true,
    ...Object.fromEntries(requiredChecks.map((key) => [key, true])),
  };
  assert.equal(verify(valid), true);
  for (const check of requiredChecks) {
    assert.throws(() => verify({ ...valid, [check]: false }), /Missing or failed release gate/);
  }
  assert.throws(() => verify({ ...valid, ciRunUrl: "https://example.org/actions/runs/123" }), /CI evidence/);
  for (const invalid of [undefined, null, 0, 1, "true", "false", {}]) {
    assert.throws(() => verify({ ...valid, firstLaunch: invalid }), /firstLaunch must be explicitly/);
  }
  for (const invalid of [null, 0, false, " ", "previous-deployment"]) {
    assert.throws(() => verify({ ...valid, rollbackDeploymentId: invalid }), /First launch cannot claim/);
  }
  assert.throws(() => verify({ ...valid, firstLaunch: false }), /rollback deployment ID/);
  assert.equal(verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "prior-deployment" }), true);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "deployment-example" }), /Rollback deployment must differ/);
  console.log("Release evidence validation self-test passed");
} else {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/check-production-release-evidence.mjs <release-evidence.json>");
    process.exitCode = 2;
  } else {
    try {
      verify(JSON.parse(await readFile(process.argv[2], "utf8")));
      console.log("Release evidence fields complete (external evidence still requires independent verification)");
    } catch (error) {
      console.error("Release evidence gate FAILED: " + error.message);
      process.exitCode = 1;
    }
  }
}
