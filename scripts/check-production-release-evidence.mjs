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
  // Nil UUIDs and all-zero sentinels (including mixed -/_ separators) cannot identify real Railway deployments.
  !/^0+(?:[-_]0+)*$/.test(value) &&
  // Reject common template placeholders as deployment/rollback evidence.
  // These are not Railway IDs and cannot prove a recoverable release.
  !/^(?:null|undefined|none|unknown|placeholder|todo|tbd|change[-_]?me|replace[-_]?me|example|sample|dummy|fake|test|deployment[-_]?id|rollback[-_]?id|your[-_]?deployment[-_]?id|your[-_]?railway[-_]?deployment[-_]?id|deployment[-_]?example|rollback[-_]?example|previous[-_]?deployment|deploy[-_]?example)$/i.test(value);

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


// Duplicate JSON object keys make audit evidence ambiguous: JSON.parse keeps
// the last value, while another reviewer may rely on an earlier occurrence.
// Check every object (including metadata nested inside arrays), and compare
// decoded key names so Unicode escapes cannot disguise duplicates.
function rejectDuplicateObjectKeys(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  let keyStart = -1;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        if (keyStart !== -1) {
          const key = JSON.parse(text.slice(keyStart, index + 1));
          const object = stack[stack.length - 1];
          if (object.seen.has(key)) {
            const scope = stack.length === 1 ? "top-level" : "nested";
            throw new Error("Duplicate " + scope + " release evidence field: " + key);
          }
          object.seen.add(key);
          object.expectingKey = false;
          keyStart = -1;
        }
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      const object = stack[stack.length - 1];
      if (object?.kind === "object" && object.expectingKey) keyStart = index;
    } else if (character === "{") {
      stack.push({ kind: "object", seen: new Set(), expectingKey: true });
    } else if (character === "[") {
      stack.push({ kind: "array" });
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === ",") {
      const object = stack[stack.length - 1];
      if (object?.kind === "object") object.expectingKey = true;
    }
  }
}

// Bound evidence input to 64 KiB before JSON parsing. A size-limited read
// avoids loading untrusted or accidentally huge evidence files into memory.
const maxEvidenceBytes = 64 * 1024;
// Validate the same open inode before and after reading release evidence.
// A writable owner process could otherwise truncate or replace the contents
// while the gate reads them, yielding an inconsistent approval record.
function assertEvidenceStable(before, after, bytesRead) {
  if (bytesRead !== before.size || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      after.ino !== before.ino || after.mode !== before.mode ||
      after.nlink !== before.nlink) {
    throw new Error("Release evidence changed during validation");
  }
}

async function readEvidence(path) {
  // Nonblocking open prevents a named pipe from hanging the release gate.
  // O_NOFOLLOW rejects symlinks before reading evidence from an unexpected target.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Release evidence must be a regular file");
    // Group- or world-writable evidence can be altered by another local process
    // between review and approval. Read-only group access remains permitted.
    if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
      throw new Error("Release evidence file must not be group- or world-writable");
    }
    // Hard links allow the same evidence inode to be modified through an alternate path.
    // Require a single directory entry so the reviewed evidence path is unambiguous.
    if (stats.nlink !== 1) throw new Error("Release evidence must not have multiple hard links");
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
    // Reject in-place mutation or truncation while the evidence was read.
    assertEvidenceStable(stats, await handle.stat(), offset);
    // Decode strictly: Buffer.toString("utf8") silently replaces malformed bytes.
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new Error("Release evidence must be encoded as valid UTF-8");
    }
    const record = JSON.parse(text);
    rejectDuplicateObjectKeys(text);
    return record;
  } finally {
    await handle.close();
  }
}

if (process.argv[2] === "--self-test") {
  const valid = {
    commitSha: "a".repeat(40),
    ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
    railwayDeploymentId: "railway_8f3a2",
    firstLaunch: true,
    rollbackVerified: false,
    ...Object.fromEntries(requiredChecks.map((key) => [key, true])),
  };
  assert.equal(verify(valid), true);
  // File identity and metadata must remain stable for the entire evidence read.
  // Use synthetic fstat snapshots to cover races deterministically without timing sleeps.
  const stableStats = { size: 42, mtimeMs: 1000, ctimeMs: 1000, ino: 123, mode: 0o100600, nlink: 1 };
  assert.doesNotThrow(() => assertEvidenceStable(stableStats, { ...stableStats }, 42));
  assert.throws(() => assertEvidenceStable(stableStats, stableStats, 41), /changed during validation/);
  for (const [field, changed] of [
    ["size", 41], ["mtimeMs", 1001], ["ctimeMs", 1001],
    ["ino", 124], ["mode", 0o100666], ["nlink", 2],
  ]) {
    assert.throws(
      () => assertEvidenceStable(stableStats, { ...stableStats, [field]: changed }, 42),
      /changed during validation/,
      `Evidence mutation of ${field} must block promotion`,
    );
  }

  // Duplicate metadata keys are also ambiguous, even inside an array.
  assert.throws(
    () => rejectDuplicateObjectKeys('{"metadata":{"smokePassed":false,"smokePassed":true}}'),
    /Duplicate nested release evidence field: smokePassed/,
  );
  const escapedNestedKey = '"ci' + String.fromCharCode(92) + 'u0050assed":true';
  assert.throws(
    () => rejectDuplicateObjectKeys('{"metadata":[{"ciPassed":false,' + escapedNestedKey + ']}'),
    /Duplicate nested release evidence field: ciPassed/,
  );
  // Reusing a key in different objects is legitimate.
  assert.doesNotThrow(
    () => rejectDuplicateObjectKeys('{"metadata":[{"check":true},{"check":false}]}'),
  );
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
  for (const invalid of [null, 0, false, " ", "railway_7b2c1"]) {
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
  for (const nilId of ["0", "000", "000_000", "00-00_00", "0_0-0", "00000000-0000-0000-0000-000000000000"]) {
    assert.throws(() => verify({ ...valid, railwayDeploymentId: nilId }), /Railway deployment ID/);
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: nilId, rollbackVerified: true }), /rollback deployment ID/);
  }
  // A populated template is not proof of a real Railway deployment or rollback target.
  for (const placeholder of ["null", "UNDEFINED", "none", "Unknown", "PLACEHOLDER", "todo", "TBD", "CHANGE_ME", "change-me", "replace_me", "REPLACE-ME", "your-deployment-id", "YOUR_DEPLOYMENT_ID", "example", "SAMPLE", "dummy", "FAKE", "test", "deployment-id", "rollback_id", "your-railway-deployment-id", "deployment-example", "DEPLOYMENT_EXAMPLE", "rollback-example", "deploy_example", "previous-deployment"]) {
    assert.throws(() => verify({ ...valid, railwayDeploymentId: placeholder }), /Railway deployment ID/);
    assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: placeholder, rollbackVerified: true }), /rollback deployment ID/);
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
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "railway_8f3a2" }), /Rollback deployment must differ/);
  assert.throws(() => verify({ ...valid, firstLaunch: false, rollbackDeploymentId: "RAILWAY_8F3A2", rollbackVerified: true }), /Rollback deployment must differ/);
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
