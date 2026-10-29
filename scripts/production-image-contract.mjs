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
  // Duplicate environment names are ambiguous: one runtime may use the first
  // value while another uses the last. Never approve an image whose effective
  // production configuration depends on environment-variable ordering.
  const seenEnvironmentNames = new Set();
  for (const entry of config.Env) {
    assert.equal(typeof entry, "string", "Production image environment entries must be strings");
    const separator = entry.indexOf("=");
    const name = separator >= 0 ? entry.slice(0, separator) : "";
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Production image environment entries must use valid NAME=value syntax");
    assert.ok(!seenEnvironmentNames.has(name),
      `Production image must not define duplicate environment variable ${name}`);
    seenEnvironmentNames.add(name);
  }
  for (const variable of ["NODE_ENV=production", "PORT=3000"]) {
    assert.ok(config.Env.includes(variable), `Production image is missing ${variable}`);
  }
  // These image-level environment variables are inherited by the web process
  // and pre-deploy commands. A release artifact must not ship with Node
  // inspector/preload overrides or disabled TLS certificate verification.
  assert.ok(!config.Env.some((variable) => variable.startsWith("NODE_OPTIONS=")),
    "Production image must not bake NODE_OPTIONS into its runtime");
  assert.ok(!config.Env.includes("NODE_TLS_REJECT_UNAUTHORIZED=0"),
    "Production image must not disable Node TLS verification");
  assert.ok(config.Env.includes("NEXT_TELEMETRY_DISABLED=1"),
    "Production image must disable Next.js telemetry");
  // OIDC trust configuration, provider credentials and database/Stripe secrets
  // must be injected by Railway at runtime, never baked into a reusable image.
  const runtimeOnly = /^(?:DATABASE_URL|OIDC_(?:ISSUER|AUDIENCE|JWKS_URL)|SECURITY_EVENT_HASH_PEPPER|METRICS_TOKEN|AI_(?:PRIMARY|SECONDARY|TERTIARY|FALLBACK)_(?:BASE_URL|API_KEY|MODEL)|STRIPE_(?:SECRET_KEY|WEBHOOK_SECRET))$/;
  for (const variable of config.Env) {
    const name = variable.split("=", 1)[0];
    assert.ok(!runtimeOnly.test(name),
      `Production image must not bake deployment-specific ${name}`);
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
    Env: ["NODE_ENV=production", "PORT=3000", "NEXT_TELEMETRY_DISABLED=1"],
    ExposedPorts: { "3000/tcp": {} },
    Healthcheck: { Test: ["CMD", "node", "-e", "http.get({path:'/api/health'})"],
      Interval: 30_000_000_000, Timeout: 5_000_000_000,
      StartPeriod: 20_000_000_000, Retries: 3 },
  };
  validate(fixture);
  for (const mutate of [
    (value) => { value.User = "root"; },
    (value) => { value.Env.push("NODE_OPTIONS=--inspect=0.0.0.0:9229"); },
    (value) => { value.Env.push("NODE_TLS_REJECT_UNAUTHORIZED=0"); },
    (value) => { value.Env.push("NODE_ENV=development"); },
    (value) => { value.Env.push("PORT=8080"); },
    (value) => { value.Env.push("NEXT_TELEMETRY_DISABLED=0"); },
    (value) => { value.Env.push("BROKEN_ENTRY"); },
    (value) => { value.Env.push("=empty-name"); },
    (value) => { value.Env.push("INVALID-NAME=value"); },
    (value) => { value.Env.push("PATH=/tmp"); value.Env.push("PATH=/usr/bin"); },
    (value) => { value.Env = value.Env.filter((entry) => entry !== "NEXT_TELEMETRY_DISABLED=1"); },
    ...["DATABASE_URL", "OIDC_ISSUER", "OIDC_JWKS_URL", "AI_PRIMARY_API_KEY", "AI_TERTIARY_API_KEY", "AI_TERTIARY_BASE_URL", "AI_FALLBACK_BASE_URL", "METRICS_TOKEN", "STRIPE_WEBHOOK_SECRET"].map(
      (name) => (value) => { value.Env.push(`${name}=test-value`); },
    ),
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
