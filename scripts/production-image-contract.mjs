#!/usr/bin/env node
// Verify the effective runtime metadata of the built production image, not only Dockerfile text.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function validate(config) {
  assert.equal(config.User, "node", "Production image must not run as root");
  assert.equal(config.WorkingDir, "/app", "Production image must start from /app");
  assert.deepEqual(config.Cmd, ["node", "node_modules/next/dist/bin/next", "start"],
    "Production image must start the expected Next.js server");
  assert.ok(Array.isArray(config.Env), "Production image must define runtime environment");
  for (const variable of ["NODE_ENV=production", "PORT=3000"]) {
    assert.ok(config.Env.includes(variable), `Production image is missing ${variable}`);
  }
  assert.deepEqual(Object.keys(config.ExposedPorts ?? {}), ["3000/tcp"],
    "Production image must expose only the application port");
  const probe = config.Healthcheck;
  assert.deepEqual(probe?.Test?.slice(0, 3), ["CMD", "node", "-e"],
    "Production image must retain its exec-form Node healthcheck");
  assert.equal(probe.Test.length, 4, "Production healthcheck must contain exactly one probe script");
  assert.match(probe.Test[3], /path:\s*['"]\/api\/health['"]/, "Docker liveness must target /api/health");
  assert.equal(probe.Interval, 30_000_000_000, "Healthcheck interval must remain 30s");
  assert.equal(probe.Timeout, 5_000_000_000, "Healthcheck timeout must remain 5s");
  assert.equal(probe.StartPeriod, 20_000_000_000, "Healthcheck start period must remain 20s");
  assert.equal(probe.Retries, 3, "Healthcheck retry count must remain 3");
}

const image = process.argv[2];
if (process.argv.length !== 3) {
  console.error("Usage: node scripts/production-image-contract.mjs <image-tag|--self-test>");
  process.exitCode = 2;
} else if (image === "--self-test") {
  const fixture = {
    User: "node", WorkingDir: "/app",
    Cmd: ["node", "node_modules/next/dist/bin/next", "start"],
    Env: ["NODE_ENV=production", "PORT=3000"],
    ExposedPorts: { "3000/tcp": {} },
    Healthcheck: { Test: ["CMD", "node", "-e", "http.get({path:'/api/health'})"],
      Interval: 30_000_000_000, Timeout: 5_000_000_000,
      StartPeriod: 20_000_000_000, Retries: 3 },
  };
  validate(fixture);
  for (const mutate of [
    (value) => { value.User = "root"; },
    (value) => { value.Cmd = ["node", "server.js"]; },
    (value) => { delete value.Healthcheck; },
    (value) => { value.Healthcheck.Test[3] = "http.get({path:'/api/ready'})"; },
    (value) => { value.ExposedPorts["9229/tcp"] = {}; },
    (value) => { value.Healthcheck.Timeout = 0; },
  ]) {
    const invalid = structuredClone(fixture);
    mutate(invalid);
    assert.throws(() => validate(invalid), "Unsafe image metadata must fail closed");
  }
  console.log("Production image contract self-test passed");
} else {
  try {
    const output = execFileSync("docker", ["image", "inspect", image], {
      encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    });
    const [inspection] = JSON.parse(output);
    assert.ok(inspection?.Config, "Docker inspection did not return image config");
    validate(inspection.Config);
    console.log("Built production Docker image runtime contract passed");
  } catch (error) {
    console.error(`Production image contract FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
