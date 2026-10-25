#!/usr/bin/env node
// Validate the completeness of a post-deployment release evidence record.
// This is a documentation/evidence gate, not proof that an external service is healthy.
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";

const ciRunPrefix = "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/";

// Railway deployment IDs are opaque identifiers, not free-form labels.
// Reject whitespace, control characters and oversized IDs in release/rollback evidence.
// The generous bound permits opaque provider IDs without accepting unbounded labels.
const validDeploymentId = (value) => typeof value === "string" &&
  /^(?=.{1,128}$)[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(value) &&
  // Nil UUIDs and all-zero sentinels cannot identify real Railway deployments.
  !/^0+(?:-0+)*$/.test(value);

const requiredChecks = [
  "ciPassed", "stagedChangesReviewed", "preflightPassed",
  "oidcVerified", "aiVerified", "postgresReady", "backupVerified",
  "migrationReviewed", "smokePassed", "postReleaseObservationPassed",
];

function verify(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Release evidence must be a JSON object");
  }
  if (typeof record.commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(record.commitSha) ||
      /^0{40}$/.test(record.commitSha)) {
    // All-zero SHA is the Git null object ID, not a deployable release commit.
    throw new Error("A nonzero full 40-character release commit SHA is required");
  }
  // A syntactically valid but out-of-range run ID cannot be represented safely
  // by JavaScript and must not be accepted as verifiable CI evidence.
  const runId = typeof record.ciRunUrl === "string" && record.ciRunUrl.startsWith(ciRunPrefix)
    ? record.ciRunUrl.slice(ciRunPrefix.length) : "";
  if (!/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(Number(runId))) {
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
    if (record.rollbackVerified !== false) {
      throw new Error("First launch requires rollbackVerified=false (no verified rollback target)");
    }
  } else {
    if (!validDeploymentId(record.rollbackDeploymentId)) {
      throw new Error("Upgrades require a recorded rollback deployment ID");
    }
    // Railway deployment identifiers may be UUIDs; letter case cannot make a deployment a valid rollback target.
    // Railway UUIDs may be recorded in canonical or compact form. Both
    // representations identify the same deployment and are not a rollback.
    const normalizedUuid = (id) => {
      if (/^[a-f0-9]{32}$/i.test(id)) return id.toLowerCase();
      if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
        return id.replace(/-/g, "").toLowerCase();
      }
      return null;
    };
    const currentUuid = normalizedUuid(record.railwayDeploymentId);
    const rollbackUuid = normalizedUuid(record.rollbackDeploymentId);
    if (record.rollbackDeploymentId.toLowerCase() === record.railwayDeploymentId.toLowerCase() ||
        (currentUuid !== null && currentUuid === rollbackUuid)) {
      throw new Error("Rollback deployment must differ from the current Railway deployment");
    }
    // An opaque ID alone does not establish that the target can be restored.
    // Require explicit operator verification before approving an upgrade.
    if (record.rollbackVerified !== true) {
      throw new Error("Upgrades require rollbackVerified=true");
    }
  }
  return true;
}

// Bound evidence input to 64 KiB before JSON parsing. A size-limited read
// avoids loading untrusted or accidentally huge evidence files into memory.
const maxEvidenceBytes = 64 * 1024;
async function readEvidence(path) {
  // Nonblocking open prevents a named pipe from hanging the release gate.
  // O_NOFOLLOW rejects symlinks before reading evidence from an unexpected target.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Release evidence must be a regular file");
    if (stats.size > maxEvidenceBytes) throw new Error("Release evidence file exceeds 65536 bytes");
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
    // Decode strictly: Buffer.toString("utf8") silently replaces malformed bytes.
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new Error("Release evidence must be encoded as valid UTF-8");
    }
    return JSON.parse(text);
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
    rollbackVerified: false,
    ...Object.fromEntries(requiredChecks.map((key) => [key, true])),
  };
  assert.equal(verify(valid), true);
  assert.throws(() => verify({ ...valid, commitSha: ["a".repeat(40)] }), /full 40-character release commit SHA/);
  assert.throws(() => verify({ ...valid, commitSha: "0".repeat(40) }), /full 40-character release commit SHA/);
  for (const check of requiredChecks) {
    assert.throws(() => verify({ ...valid, [check]: false }), /Missing or failed release gate/);
  }
  assert.throws(() => verify({ ...valid, ciRunUrl: "https://example.org/actions/runs/123" }), /CI evidence/);
  for (const invalidUrl of [ciRunPrefix + "123?attempt=2", ciRunPrefix + "123#logs", ciRunPrefix + "123/", ciRunPrefix + "123%2F"]) {
    assert.throws(() => verify({ ...valid, ciRunUrl: invalidUrl }), /CI evidence/);
  }
  for (const invalidUrl of [ciRunPrefix + "9007199254740992", ciRunPrefix + "9".repeat(100)]) {
    assert.throws(() => verify({ ...valid, ciRunUrl: invalidUrl }), /CI evidence/);
  }
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
  // An opaque deployment ID must contain an identifier, not just punctuation.
  for (const invalidId of ["-", "_", "---", "___", "-deployment", "deployment-", "_deployment", "deployment_"]) {
    assert.throws(() => verify({ ...valid, railwayDeploymentId: invalidId }), /Railway deployment ID/);
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: invalidId }), /rollback deployment ID/);
  }
  // Never accept placeholder all-zero IDs as deployment or rollback evidence.
  for (const nilId of ["0", "000", "00000000-0000-0000-0000-000000000000"]) {
    assert.throws(() => verify({ ...valid, railwayDeploymentId: nilId }), /Railway deployment ID/);
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: nilId, rollbackVerified: true }), /rollback deployment ID/);
  }
  assert.equal(verify({ ...valid, railwayDeploymentId: "0000-a" }), true);
  assert.equal(verify({ ...valid, railwayDeploymentId: "deploy_123-A" }), true);
  assert.equal(verify({ ...valid, railwayDeploymentId: "x".repeat(128) }), true);
  assert.throws(() => verify({ ...valid, railwayDeploymentId: "x".repeat(129) }), /Railway deployment ID/);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "x".repeat(129) }), /rollback deployment ID/);
  assert.throws(() => verify({ ...valid, firstLaunch: false }), /rollback deployment ID/);
  for (const invalid of [undefined, null, true, "false", "true", 0, 1, {}]) {
    assert.throws(() => verify({ ...valid, rollbackVerified: invalid }), /First launch requires rollbackVerified=false/);
  }
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "prior-deployment" }), /rollbackVerified=true/);
  for (const invalid of [false, null, "true", 1, {}]) {
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "prior-deployment", rollbackVerified: invalid }), /rollbackVerified=true/);
  }
  assert.equal(verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "prior-deployment", rollbackVerified: true }), true);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "deployment-example" }), /Rollback deployment must differ/);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "DEPLOYMENT-EXAMPLE", rollbackVerified: true }), /Rollback deployment must differ/);
  // UUID punctuation and case must not disguise a rollback to the active deployment.
  const canonicalUuid = "123e4567-e89b-12d3-a456-426614174000";
  const compactUuid = "123e4567e89b12d3a456426614174000";
  assert.throws(() => verify({ ...valid, firstLaunch: false, railwayDeploymentId: canonicalUuid, rollbackDeploymentId: compactUuid, rollbackVerified: true }), /Rollback deployment must differ/);
  assert.throws(() => verify({ ...valid, firstLaunch: false, railwayDeploymentId: compactUuid.toUpperCase(), rollbackDeploymentId: canonicalUuid, rollbackVerified: true }), /Rollback deployment must differ/);
  assert.equal(verify({ ...valid, firstLaunch: false, railwayDeploymentId: canonicalUuid, rollbackDeploymentId: "123e4567-e89b-12d3-a456-426614174001", rollbackVerified: true }), true);
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
