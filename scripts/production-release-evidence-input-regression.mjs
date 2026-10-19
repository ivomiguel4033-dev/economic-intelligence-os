#!/usr/bin/env node
// Regression checks: invalid release evidence must never pass the CLI gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  console.log("Production release evidence input regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
