#!/usr/bin/env node
// Validate the completeness of a post-deployment release evidence record.
// This is a documentation/evidence gate, not proof that an external service is healthy.
import assert from "node:assert/strict";
import { open } from "node:fs/promises";

const ciRunPrefix = "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/";

// Railway deployment IDs are opaque identifiers, not free-form labels.
// Reject whitespace, control characters and oversized IDs in release/rollback evidence.
// The generous bound permits opaque provider IDs without accepting unbounded labels.
const validDeploymentId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const requiredChecks = [
  "ciPassed", "stagedChangesReviewed", "preflightPassed",
  "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
  "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
];

function verify(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Release evidence must be a JSON object");
  }
  if (typeof record.commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(record.commitSha)) {
    throw new Error("A full 40-character release commit SHA is required");
  }
  if (typeof record.ciRunUrl !== "string" ||
      !new RegExp("^" + ciRunPrefix.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&") + "[1-9][0-9]*$").test(record.ciRunUrl)) {
    throw new Error("CI evidence must link to a run in this repository");
  }
  for (const check of requiredChecks) {
    if (record[check] !== true) throw new Error("Missing or failed release gate: " + check);
  }
  if (!validDeploymentId(record.railwayDeploymentId)) {
    throw new Error("Railway deployment ID is required");
  }
  if (typeof record.firstLaunch !== "boolean") {
    throw new Error("firstLaunch must be explicitly true or false");
  }
  if (record.firstLaunch === true) {
    if (record.rollbackDeploymentId !== undefined && record.rollbackDeploymentId !== "") {
      throw new Error("First launch cannot claim an existing rollback target");
    }
  } else if (!validDeploymentId(record.rollbackDeploymentId)) {
    throw new Error("Upgrades require a recorded rollback deployment ID");
  }
  if (record.firstLaunch === false && record.rollbackDeploymentId === record.railwayDeploymentId) {
    throw new Error("Rollback deployment must differ from the current Railway deployment");
  }
  return true;
}

// Bound evidence input to 64 KiB before JSON parsing. A size-limited read
// avoids loading untrusted or accidentally huge evidence files into memory.
const maxEvidenceBytes = 64 * 1024;
async function readEvidence(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxEvidenceBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxEvidenceBytes) {
      throw new Error("Release evidence file exceeds 65536 bytes");
    }
    return JSON.parse(buffer.subarray(0, offset).toString("utf8"));
  } finally {
    await handle.close();
  }
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
  assert.throws(() => verify({ ...valid, commitSha: ["a".repeat(40)] }), /full 40-character release commit SHA/);
  for (const check of requiredChecks) {
    assert.throws(() => verify({ ...valid, [check]: false }), /Missing or failed release gate/);
  }
  assert.throws(() => verify({ ...valid, ciRunUrl: "https://example.org/actions/runs/123" }), /CI evidence/);
  for (const invalidUrl of [ciRunPrefix + "0", ciRunPrefix + "000", ciRunPrefix + "0123"]) {
    assert.throws(() => verify({ ...valid, ciRunUrl: invalidUrl }), /CI evidence/);
  }
  for (const invalid of [undefined, null, 0, 1, "true", "false", {}]) {
    assert.throws(() => verify({ ...valid, firstLaunch: invalid }), /firstLaunch must be explicitly/);
  }
  for (const invalid of [null, 0, false, " ", "previous-deployment"]) {
    assert.throws(() => verify({ ...valid, rollbackDeploymentId: invalid }), /First launch cannot claim/);
  }
  for (const invalidId of [" candidate", "candidate ", "candidate deployment", "candidate\nnext", "candidate\t", "candidate/next", "é", ""]) {
    assert.throws(() => verify({ ...valid, railwayDeploymentId: invalidId }), /Railway deployment ID/);
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: invalidId }), /rollback deployment ID/);
  }
  assert.equal(verify({ ...valid, railwayDeploymentId: "x".repeat(128) }), true);
  assert.throws(() => verify({ ...valid, railwayDeploymentId: "x".repeat(129) }), /Railway deployment ID/);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "x".repeat(129) }), /rollback deployment ID/);
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
      verify(await readEvidence(process.argv[2]));
      console.log("Release evidence fields complete (external evidence still requires independent verification)");
    } catch (error) {
      console.error("Release evidence gate FAILED: " + error.message);
      process.exitCode = 1;
    }
  }
}
