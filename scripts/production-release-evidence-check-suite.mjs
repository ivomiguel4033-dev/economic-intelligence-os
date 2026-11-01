#!/usr/bin/env node
// Local, dependency-free release evidence regression gate.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checks = [
  "check-production-release-evidence.mjs",
  "production-release-evidence-draft.mjs",
  "production-release-evidence-draft-regression.mjs",
  "production-release-evidence-regression.mjs",
  "production-release-evidence-input-regression.mjs",
];
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  const args = name.endsWith("-regression.mjs") ? [] : ["--self-test"];
  console.log("Running release evidence check: " + name);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    timeout: 15000,
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
