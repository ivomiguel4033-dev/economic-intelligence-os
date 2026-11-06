#!/usr/bin/env node
// Local, dependency-free release evidence regression gate.
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
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
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  // Fail with a precise diagnostic if release evidence checks are missing or replaced.
  try {
    // Reject symlinks so the release gate cannot execute a redirected script.
    if (!lstatSync(script).isFile()) throw new Error("not a regular file or is a symbolic link");
  } catch (error) {
    console.error("Release evidence check unavailable: " + name + " (" + error.message + ")");
    process.exitCode = 1;
    break;
  }
  const args = name.endsWith("-regression.mjs") ? [] : ["--self-test"];
  console.log("Running release evidence check: " + name);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], {
    // Release gates are non-interactive: do not inherit operator stdin.\n    stdio: ["ignore", "inherit", "inherit"],
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
