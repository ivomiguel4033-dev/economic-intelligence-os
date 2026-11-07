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
    // Bound source reads: an oversized gate must not exhaust runner memory during preflight.
    if (metadata.size > 2 * 1024 * 1024) throw new Error("release evidence check exceeds 2 MiB source limit");
    // An empty JavaScript file exits successfully without running any assertions.
    // Comments and empty statements alone are not executable validation; reject no-op gates.
    const source = readFileSync(script, "utf8");
    // A shebang is metadata, not an executable assertion.
    const executableText = source.replace(/^#![^\r\n]*/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
    if (metadata.size === 0 || /^[;\s]*$/.test(executableText)) {
      throw new Error("empty, comment-only, or empty-statement-only release evidence check");
    }
    validatedHashes.set(name, createHash("sha256").update(source).digest("hex"));
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
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  // Refuse a gate modified after preflight instead of executing unvalidated code.
  try {
    const metadata = lstatSync(script);
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) throw new Error("gate is no longer a bounded regular file");
    const currentHash = createHash("sha256").update(readFileSync(script)).digest("hex");
    if (currentHash !== validatedHashes.get(name)) throw new Error("gate content changed after preflight");
  } catch (error) {
    console.error("Release evidence check changed: " + name + " (" + error.message + ")");
    process.exitCode = 1;
    break;
  }
  const args = name.endsWith("-regression.mjs") ? [] : ["--self-test"];
  console.log("Running release evidence check: " + name);
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
    break;
  }
  console.log("Release evidence check passed: " + name + " (" + (Date.now() - startedAt) + " ms)");
}
if (!process.exitCode) console.log("Production release evidence suite passed");
