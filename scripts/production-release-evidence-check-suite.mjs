#!/usr/bin/env node
// Local, dependency-free release evidence regression gate.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const checks = [
  "check-production-release-evidence.mjs",
  "production-release-evidence-draft.mjs",
  "production-release-evidence-draft-regression.mjs",
  "production-release-evidence-regression.mjs",
  "production-release-evidence-input-regression.mjs",
];
// A missing or duplicated gate can silently weaken release validation.
if (checks.length === 0 || new Set(checks).size !== checks.length || checks.some((name) => !/^[a-z0-9-]+\.mjs$/.test(name))) {
  console.error("Release evidence gate configuration invalid: checks must be non-empty, unique, and local .mjs filenames");
  process.exit(1);
}
// Record preflighted content so gates cannot change between validation and execution.
const validatedHashes = new Map();
// Preflight every gate before executing any, avoiding partial runs with missing checks.
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  // Fail with a precise diagnostic if release evidence checks are missing or replaced.
  try {
    // Reject symlinks so the release gate cannot execute a redirected script.
    const metadata = lstatSync(script);
    if (!metadata.isFile()) throw new Error("not a regular file or is a symbolic link");
    // Hard links can redirect writes through another path after validation.
    if (metadata.nlink !== 1) throw new Error("release evidence check must not be hard-linked");
    // Shared runners must not execute validation scripts writable by group or other users.
    if ((metadata.mode & 0o022) !== 0) throw new Error("release evidence check is group- or world-writable");
    // Bound source reads: an oversized gate must not exhaust runner memory during preflight.
    if (metadata.size > 2 * 1024 * 1024) throw new Error("release evidence check exceeds 2 MiB source limit");
    // An empty JavaScript file exits successfully without running any assertions.
    // Comments and empty statements alone are not executable validation; reject no-op gates.
    const sourceBytes = readFileSync(script);
    // Recheck the actual bytes: the file may grow after lstatSync (TOCTOU).
    if (sourceBytes.length > 2 * 1024 * 1024) throw new Error("release evidence check exceeds 2 MiB source limit");
    // Fail closed if the file changed size between stat and read.
    if (sourceBytes.length !== metadata.size) throw new Error("release evidence check size changed during preflight");
    // Reject a leading BOM before decoding: TextDecoder strips it by default.
    if (sourceBytes.length >= 3 && sourceBytes[0] === 0xef && sourceBytes[1] === 0xbb && sourceBytes[2] === 0xbf) {
      throw new Error("UTF-8 BOM in release evidence check source");
    }
    // Reject malformed UTF-8 instead of silently replacing bytes with U+FFFD.
    // Release evidence source must be unambiguous across runtimes and reviewers.
    const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
    // Even well-formed UTF-8 can contain a literal replacement character, masking a
    // previously corrupted source byte sequence in copied or regenerated gate files.
    if (source.includes("\uFFFD")) throw new Error("Unicode replacement character in release evidence check source");
    // Unicode noncharacters have no legitimate role in executable release gates and
    // can render inconsistently in logs or code review tools.
    if (/[\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u.test(source)) {
      throw new Error("Unicode noncharacter in release evidence check source");
    }
    // NUL bytes are never valid in maintained JavaScript gate sources; reject binary contamination.
    if (source.includes("\0")) throw new Error("NUL byte in release evidence check source");
    // C0 (except tab, LF and CR), DEL and C1 controls can hide or distort source in CI logs and reviews.
    // Reject C1 even when encoded as valid UTF-8: terminal behavior differs between viewers.
    if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(source)) {
      throw new Error("unexpected control character in release evidence check source");
    }
    // Bare carriage returns can overwrite displayed log lines and obscure gate statements.
    // CRLF is permitted for cross-platform checkouts; a standalone CR is not.
    if (/\r(?!\n)/u.test(source)) {
      throw new Error("standalone carriage return in release evidence check source");
    }
    // Reject Unicode line/paragraph separators: tools disagree on whether these are line breaks,
    // which can hide statement boundaries in review output and release evidence logs.
    if (/[\u2028\u2029]/u.test(source)) {
      throw new Error("Unicode line or paragraph separator in release evidence check source");
    }
    // Reject Unicode bidirectional controls that can visually disguise executable code in reviews.
    if (/[\u202a-\u202e\u2066-\u2069]/u.test(source)) {
      throw new Error("bidirectional Unicode control character in release evidence check source");
    }
    // Invisible format and supplementary-plane Unicode tag characters can conceal changes to gate source.
    if (/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u2060-\u206f\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/u.test(source)) {
      throw new Error("invisible Unicode format character in release evidence check source");
    }
    // Conflict markers, including indented ones, indicate an unresolved merge and must never reach release gates.
    if (/^[ \t]*(?:<{7}|\|{7}|={7}|>{7})(?:[ \t]|$|(?=[A-Za-z0-9_-]))/m.test(source)) {
      throw new Error("unresolved merge conflict marker in release evidence check");
    }
    // A shebang is metadata, not an executable assertion.
    const executableText = source.replace(/^#![^\r\n]*/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
    if (metadata.size === 0 || /^[;\s]*$/.test(executableText)) {
      throw new Error("empty, comment-only, or empty-statement-only release evidence check");
    }
    validatedHashes.set(name, createHash("sha256").update(sourceBytes).digest("hex"));
  } catch (error) {
    console.error("Release evidence check unavailable: " + name + " (" + error.message + ")");
    process.exit(1);
  }
  // Parse all gates before running any: syntax errors must fail the preflight,
  // rather than allowing earlier checks to run before the suite fails.
  const syntax = spawnSync(process.execPath, ["--check", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    // Bound captured diagnostics so malformed gates cannot exhaust CI memory.
    maxBuffer: 64 * 1024,
    timeout: 15000,
    killSignal: "SIGKILL",
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", NODE_V8_COVERAGE: "" },
  });
  if (syntax.error || syntax.status !== 0) {
    const detail = syntax.error?.code === "ETIMEDOUT"
      ? "syntax preflight timed out after 15 seconds"
      : syntax.error?.message || syntax.stderr?.trim() || (syntax.signal ? `terminated by signal ${syntax.signal}` : `exit status ${syntax.status}`);
    console.error("Release evidence check syntax invalid: " + name + " (" + detail + ")");
    process.exit(1);
  }
}
// Syntax checks are subprocesses too: verify that none altered another gate
// before starting any executable release validation.
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  try {
    const metadata = lstatSync(script);
    if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || metadata.size > 2 * 1024 * 1024) {
      throw new Error("gate is no longer a bounded, unlinked regular file");
    }
    const bytes = readFileSync(script);
    if (bytes.length !== metadata.size || bytes.length > 2 * 1024 * 1024 ||
        createHash("sha256").update(bytes).digest("hex") !== validatedHashes.get(name)) {
      throw new Error("gate content changed during syntax preflight");
    }
  } catch (error) {
    console.error("Release evidence check changed during syntax preflight: " + name + " (" + error.message + ")");
    process.exit(1);
  }
}
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  // Refuse a gate modified after preflight instead of executing unvalidated code.
  try {
    const metadata = lstatSync(script);
    if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || metadata.size > 2 * 1024 * 1024) throw new Error("gate is no longer a bounded, unlinked regular file");
    // Recheck bytes read after metadata inspection: a concurrent write can grow the file.
    const currentBytes = readFileSync(script);
    if (currentBytes.length > 2 * 1024 * 1024) throw new Error("gate exceeds 2 MiB source limit after read");
    // Detect concurrent size changes between lstat and read before executing a gate.
    if (currentBytes.length !== metadata.size) throw new Error("gate size changed during integrity verification");
    const currentHash = createHash("sha256").update(currentBytes).digest("hex");
    if (currentHash !== validatedHashes.get(name)) throw new Error("gate content changed after preflight");
  } catch (error) {
    console.error("Release evidence check changed: " + name + " (" + error.message + ")");
    process.exitCode = 1;
    break;
  }
  const args = name.endsWith("-regression.mjs") ? [] : ["--self-test"];
  // Include the preflight-approved digest in CI logs so each gate execution can be
  // matched to the exact source that passed syntax and integrity checks.
  console.log("Running release evidence check: " + name + " (sha256=" + validatedHashes.get(name) + ")");
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], {
    // Release gates are non-interactive: do not inherit operator stdin.
    stdio: ["ignore", "inherit", "inherit"],
    // Run every gate from the repository root, independent of caller cwd.
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    // Do not allow ambient NODE_OPTIONS (e.g. --require/--import) to inject
    // operator-local code into release gates; keep other CI environment intact.
    // NODE_PATH can also redirect CommonJS module resolution to ambient code.
    // Disable inherited V8 coverage output to prevent local instrumentation
    // from writing unexpected artifacts during the release evidence gate.
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", NODE_V8_COVERAGE: "" },
    timeout: 15000,
    // Forcefully terminate hung gates even if they ignore SIGTERM.
    killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code === "ETIMEDOUT"
      ? "timed out after 15 seconds"
      : result.error
        ? result.error.message
        : result.signal
          ? "terminated by signal " + result.signal
          : "exit status " + result.status;
    console.error("Release evidence check failed: " + name + " (" + reason + ", " + (Date.now() - startedAt) + " ms)");
    process.exitCode = 1;
    // Still verify all gate sources below: a failed gate may have tampered with them.
  }
  // A running gate must not rewrite itself OR another approved gate. Check all
  // sources after each execution, including gates that have already passed.
  try {
    for (const checkedName of checks) {
      const checkedScript = fileURLToPath(new URL("./" + checkedName, import.meta.url));
      const metadata = lstatSync(checkedScript);
      if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || metadata.size > 2 * 1024 * 1024) throw new Error(checkedName + ": no longer a bounded, unlinked regular file");
      const bytes = readFileSync(checkedScript);
      // A gate may grow after lstatSync; enforce the same bound on actual bytes.
      if (bytes.length > 2 * 1024 * 1024) throw new Error(checkedName + ": exceeds 2 MiB source limit after execution");
      if (bytes.length !== metadata.size || createHash("sha256").update(bytes).digest("hex") !== validatedHashes.get(checkedName)) {
        throw new Error(checkedName + ": content changed during execution");
      }
    }
  } catch (error) {
    console.error("Release evidence check changed after " + name + " (" + error.message + ")");
    process.exitCode = 1;
    break;
  }
  // A failed gate must never be reported as passed, even when integrity is intact.
  if (result.error || result.status !== 0) break;
  console.log("Release evidence check passed: " + name + " (" + (Date.now() - startedAt) + " ms)");
}
if (!process.exitCode) console.log("Production release evidence suite passed");
