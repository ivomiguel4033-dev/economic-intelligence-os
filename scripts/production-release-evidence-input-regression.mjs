#!/usr/bin/env node
// Regression checks: invalid release evidence must never pass the CLI gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./check-production-release-evidence.mjs", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "release-evidence-input-"));

function expectRejected(path, label, reason = /Release evidence gate FAILED:/) {
  const result = spawnSync(process.execPath, [validator, path], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, label + ": process error");
  assert.equal(result.status, 1, label + ": must fail closed");
  assert.match(result.stderr, reason, label);
}

function expectAccepted(path, label) {
  const result = spawnSync(process.execPath, [validator, path], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, label + ": process error");
  assert.equal(result.status, 0, label + ": valid evidence must pass");
  assert.match(result.stdout, /Release evidence fields complete/, label);
}

try {
  expectRejected(join(directory, "missing.json"), "Missing evidence file");
  for (const [name, body] of [
    ["malformed.json", "{not-json"],
    ["empty.json", ""],
    ["array.json", "[]"],
    ["null.json", "null"],
  ]) {
    const path = join(directory, name);
    writeFileSync(path, body);
    expectRejected(path, name);
  }
  const invalidUtf8 = join(directory, "invalid-utf8.json");
  writeFileSync(invalidUtf8, Buffer.concat([
    Buffer.from('{"note":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}'),
  ]));
  expectRejected(invalidUtf8, "Malformed UTF-8 evidence", /encoded as valid UTF-8/);
  const oversized = join(directory, "oversized.json");
  writeFileSync(oversized, JSON.stringify({ note: "x".repeat(70_000) }));
  expectRejected(oversized, "Oversized evidence file", /Release evidence file exceeds 65536 bytes/);

  // Exercise the exact byte boundary with a complete, valid release record.
  // A valid 64 KiB record must pass, while one additional byte must fail.
  const validRecord = {
    commitSha: "a".repeat(40),
    ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
    railwayDeploymentId: "deployment-example",
    firstLaunch: true,
    rollbackVerified: false,
    ciPassed: true,
    stagedChangesReviewed: true,
    preflightPassed: true,
    oidcVerified: true,
    aiVerified: true,
    postgresReady: true,
    backupVerified: true,
    migrationReviewed: true,
    smokePassed: true,
    postReleaseObservationPassed: true,
  };

  // Evidence must not be modifiable by unrelated local users or group members.
  // Read-only group access is allowed; removing write access restores approval.
  if (process.platform !== "win32") {
    const writablePath = join(directory, "world-writable-evidence.json");
    writeFileSync(writablePath, JSON.stringify(validRecord));
    chmodSync(writablePath, 0o666);
    expectRejected(writablePath, "World-writable evidence", /must not be group- or world-writable/);
    chmodSync(writablePath, 0o660);
    expectRejected(writablePath, "Group-writable evidence", /must not be group- or world-writable/);
    chmodSync(writablePath, 0o640);
    expectAccepted(writablePath, "Group-readable evidence file");
    chmodSync(writablePath, 0o600);
    expectAccepted(writablePath, "Private evidence file");
  }

  // Duplicate release gates can be interpreted differently by operators and parsers.
  // JSON.parse would silently keep the last value and approve the record.
  const duplicateGatePath = join(directory, "duplicate-smoke-gate.json");
  writeFileSync(duplicateGatePath, JSON.stringify(validRecord).replace(
    '"smokePassed":true', '"smokePassed":false,"smokePassed":true',
  ));
  expectRejected(duplicateGatePath, "Duplicate smoke gate", /Duplicate top-level release evidence field: smokePassed/);

  // Escaped JSON member names must be compared after decoding.
  const escapedKey = '"ci' + String.fromCharCode(92) + 'u0050assed":true';
  const escapedGatePath = join(directory, "escaped-duplicate-ci-gate.json");
  writeFileSync(escapedGatePath, JSON.stringify(validRecord).replace(
    '"ciPassed":true', '"ciPassed":false,' + escapedKey,
  ));
  expectRejected(escapedGatePath, "Escaped duplicate CI gate", /Duplicate top-level release evidence field: ciPassed/);

  // A nested metadata key or key-looking text in a value is not a duplicate.
  const nestedKeyPath = join(directory, "nested-metadata.json");
  writeFileSync(nestedKeyPath, JSON.stringify({
    ...validRecord, metadata: { smokePassed: false }, note: 'text with "ciPassed": false',
  }));
  expectAccepted(nestedKeyPath, "Nested metadata and quoted text");

  const emptyPaddingBody = JSON.stringify({ ...validRecord, padding: "" });
  const paddingLength = 65_536 - Buffer.byteLength(emptyPaddingBody, "utf8");
  assert.ok(paddingLength > 0, "Valid evidence fits within the byte limit");
  const boundaryBody = JSON.stringify({ ...validRecord, padding: "x".repeat(paddingLength) });
  assert.equal(Buffer.byteLength(boundaryBody, "utf8"), 65_536);
  const boundaryPath = join(directory, "exactly-65536.json");
  writeFileSync(boundaryPath, boundaryBody);
  expectAccepted(boundaryPath, "Valid evidence exactly at 64 KiB");
  const oneByteOver = join(directory, "65537.json");
  writeFileSync(oneByteOver, JSON.stringify({ ...validRecord, padding: "x".repeat(paddingLength + 1) }));
  expectRejected(oneByteOver, "Valid evidence exceeding the byte limit by one", /Release evidence file exceeds 65536 bytes/);

  // Evidence must be an actual file, not a directory, a symlink or a blocking FIFO.
  expectRejected(directory, "Directory cannot be release evidence", /regular file/);
  if (process.platform !== "win32") {
    const linkPath = join(directory, "linked-evidence.json");
    symlinkSync(boundaryPath, linkPath);
    expectRejected(linkPath, "Symlink must not redirect release evidence");
  }
  if (process.platform === "linux") {
    const fifoPath = join(directory, "pipe-evidence.json");
    const created = spawnSync("mkfifo", [fifoPath], { timeout: 5000 });
    assert.equal(created.error, undefined, "FIFO fixture command must execute");
    assert.equal(created.status, 0, "FIFO fixture must be created");
    expectRejected(fifoPath, "FIFO evidence must fail without blocking", /regular file/);
  }
  console.log("Production release evidence input regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
