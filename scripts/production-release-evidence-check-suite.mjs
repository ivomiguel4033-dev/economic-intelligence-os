#!/usr/bin/env node
// Local, dependency-free release evidence regression gate.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checks = [
  "check-production-release-evidence.mjs",
  "production-release-evidence-draft.mjs",
  "production-release-evidence-draft-regression.mjs",
  "production-release-evidence-regression.mjs",
];
for (const name of checks) {
  const script = fileURLToPath(new URL("./" + name, import.meta.url));
  const args = name.endsWith("-regression.mjs") ? [] : ["--self-test"];
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    console.error("Release evidence check failed: " + name);
    process.exitCode = 1;
    break;
  }
}
if (!process.exitCode) console.log("Production release evidence suite passed");
