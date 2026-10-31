#!/usr/bin/env node
// Static release gate: reject accidental Railway drift before deployment.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../railway.json", import.meta.url)), "utf8"));
assert.equal(config.build?.builder, "DOCKERFILE", "Production must use the reviewed Dockerfile");
assert.equal(config.build?.dockerfilePath, "Dockerfile", "Unexpected production Dockerfile");
assert.equal(config.deploy?.preDeployCommand, "node scripts/production-preflight.mjs && npm run migrate",
  "Preflight must precede database migrations");
assert.equal(config.deploy?.startCommand, "node node_modules/next/dist/bin/next start",
  "Unexpected runtime entrypoint (legacy worker must not start)");
assert.equal(config.deploy?.healthcheckPath, "/api/ready", "Readiness, not liveness, must gate deploy");
assert.ok(Number.isInteger(config.deploy?.healthcheckTimeout) &&
  config.deploy.healthcheckTimeout >= 60 && config.deploy.healthcheckTimeout <= 300,
  "Healthcheck timeout must be bounded");
assert.ok(typeof config.deploy?.drainingSeconds === "string" &&
  /^(?:0|[1-9][0-9]*)$/.test(config.deploy.drainingSeconds) &&
  Number.isSafeInteger(Number(config.deploy.drainingSeconds)) &&
  Number(config.deploy.drainingSeconds) >= 30 && Number(config.deploy.drainingSeconds) <= 60,
  "Draining interval must be a canonical decimal string between 30 and 60 seconds");
assert.equal(config.deploy?.restartPolicyType, "ON_FAILURE", "Unexpected restart policy");
assert.ok(Number.isInteger(config.deploy?.restartPolicyMaxRetries) &&
  config.deploy.restartPolicyMaxRetries >= 1 && config.deploy.restartPolicyMaxRetries <= 10,
  "Restart retries must be bounded");
console.log("Railway production configuration contract passed");
