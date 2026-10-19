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
  console.log("Production release evidence input regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
