#!/usr/bin/env node
// Verify the effective runtime metadata of the built production image, not only Dockerfile text.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Pin the built image healthcheck to the exact Dockerfile probe. Checking only
// its path allows a changed probe to always exit 0 while mentioning /api/health.
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const healthcheckLines = dockerfile.split(/\r?\n/).filter((line) => line.startsWith("HEALTHCHECK "));
assert.equal(healthcheckLines.length, 1, "Dockerfile must define exactly one healthcheck");
const commandMarker = " CMD ";
assert.ok(healthcheckLines[0].includes(commandMarker), "Dockerfile healthcheck must use exec-form CMD");
const expectedProbeArgs = JSON.parse(healthcheckLines[0].slice(healthcheckLines[0].indexOf(commandMarker) + commandMarker.length));
assert.ok(Array.isArray(expectedProbeArgs) && expectedProbeArgs.length === 3,
  "Dockerfile healthcheck must use a single Node inline probe");
const expectedHealthcheckTest = ["CMD", ...expectedProbeArgs];

function validate(config) {
  assert.equal(config.User, "node", "Production image must not run as root");
  assert.equal(config.WorkingDir, "/app", "Production image must start from /app");
  assert.deepEqual(config.Cmd, ["node", "node_modules/next/dist/bin/next", "start"],
    "Production image must start the expected Next.js server");
  // Docker runs Entrypoint before Cmd. A changed entrypoint can bypass the
  // approved server command even when Cmd itself matches the expected value.
  assert.deepEqual(config.Entrypoint, ["docker-entrypoint.sh"],
    "Production image must retain the trusted Node base-image entrypoint");
  // Docker defaults to SIGTERM, which lets the Next.js process drain in-flight
  // requests. An explicit SIGKILL/SIGQUIT override would bypass graceful shutdown.
  assert.ok(config.StopSignal == null || config.StopSignal === "" || config.StopSignal === "SIGTERM",
    "Production image must preserve SIGTERM graceful shutdown");
  // Railway's 30-second draining window must not be shortened by an image-level
  // Docker stop timeout. An unset timeout delegates the policy to the runtime.
  // Reject zero, fractional and excessive overrides as unsafe release metadata.
  assert.ok(config.StopTimeout == null ||
    (Number.isInteger(config.StopTimeout) && config.StopTimeout >= 30 && config.StopTimeout <= 120),
    "Production image stop timeout must allow 30-120s of graceful draining");
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
  // OIDC discovery and AI provider calls must not inherit image-baked proxy
  // routing or custom TLS trust anchors. Operators may inject these settings
  // explicitly at runtime, but a reusable release image must not carry them.
  const networkOverrides = /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/i;
  for (const variable of config.Env) {
    const name = variable.split("=", 1)[0];
    assert.ok(!networkOverrides.test(name),
      `Production image must not bake network override ${name}`);
  }
  assert.ok(config.Env.includes("NEXT_TELEMETRY_DISABLED=1"),
    "Production image must disable Next.js telemetry");
  // OIDC trust configuration, provider credentials and database/Stripe secrets
  // must be injected by Railway at runtime, never baked into a reusable image.
  // Keep entire deployment-specific namespaces out of reusable images, including
  // future provider/OIDC settings not yet enumerated in the application code.
  // Case variants are still deployment-specific and may contain credentials;
  // reject them before a future consumer or entrypoint normalizes their names.
  const runtimeOnly = /^(?:DATABASE_[A-Z0-9_]+|PG[A-Z0-9_]+|OIDC_[A-Z0-9_]+|SECURITY_EVENT_HASH_PEPPER|METRICS_TOKEN|AI_[A-Z0-9_]+|STRIPE_[A-Z0-9_]+)$/i;
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
  assert.deepEqual(probe.Test, expectedHealthcheckTest,
    "Built image healthcheck must match the audited Dockerfile probe exactly");
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
    Entrypoint: ["docker-entrypoint.sh"],
    Env: ["NODE_ENV=production", "PORT=3000", "NEXT_TELEMETRY_DISABLED=1"],
    ExposedPorts: { "3000/tcp": {} },
    Healthcheck: { Test: [...expectedHealthcheckTest],
      Interval: 30_000_000_000, Timeout: 5_000_000_000,
      StartPeriod: 20_000_000_000, Retries: 3 },
  };
  validate(fixture);
  // Both Docker's implicit default and an explicit SIGTERM are safe.
  validate({ ...fixture, StopSignal: "SIGTERM" });
  validate({ ...fixture, StopTimeout: 30 });
  validate({ ...fixture, StopTimeout: 120 });
  for (const timeout of [0, 1, 29, -1, 30.5, "30", 121, Infinity]) {
    assert.throws(() => validate({ ...fixture, StopTimeout: timeout }),
      /stop timeout must allow 30-120s/,
      `Unsafe Docker StopTimeout ${String(timeout)} must block promotion`);
  }
  for (const mutate of [
    (value) => { value.User = "root"; },
    (value) => { value.Env.push("NODE_OPTIONS=--inspect=0.0.0.0:9229"); },
    (value) => { value.Env.push("NODE_TLS_REJECT_UNAUTHORIZED=0"); },
    ...["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"].map(
      (name) => (value) => { value.Env.push(`${name}=https://untrusted-proxy.example`); },
    ),
    (value) => { value.Env.push("NODE_ENV=development"); },
    (value) => { value.Env.push("PORT=8080"); },
    (value) => { value.Env.push("NEXT_TELEMETRY_DISABLED=0"); },
    (value) => { value.Env.push("BROKEN_ENTRY"); },
    (value) => { value.Env.push("=empty-name"); },
    (value) => { value.Env.push("INVALID-NAME=value"); },
    (value) => { value.Env.push("PATH=/tmp"); value.Env.push("PATH=/usr/bin"); },
    (value) => { value.Env = value.Env.filter((entry) => entry !== "NEXT_TELEMETRY_DISABLED=1"); },
    ...["DATABASE_URL", "DATABASE_READ_REPLICA_URL", "PGPASSWORD", "PGHOST", "OIDC_ISSUER", "OIDC_JWKS_URL", "OIDC_CLIENT_SECRET", "AI_PRIMARY_API_KEY", "AI_TERTIARY_API_KEY", "AI_TERTIARY_BASE_URL", "AI_TERTIARY_TIMEOUT_MS", "AI_FALLBACK_BASE_URL", "METRICS_TOKEN", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_KEY"].map(
      (name) => (value) => { value.Env.push(`${name}=test-value`); },
    ),
    // Mixed/lowercase secret names must not bypass image-level redaction.
    ...["database_url", "pgpassword", "oidc_issuer", "Ai_Primary_Api_Key", "stripe_webhook_secret", "metrics_token", "security_event_hash_pepper"].map(
      (name) => (value) => { value.Env.push(`${name}=test-secret`); },
    ),
    (value) => { value.Cmd = ["node", "server.js"]; },
    (value) => { value.Entrypoint = ["sh", "-c", "exit 0"]; },
    (value) => { value.Entrypoint = ["docker-entrypoint.sh", "--unsafe"]; },
    (value) => { delete value.Entrypoint; },
    (value) => { value.StopSignal = "SIGKILL"; },
    (value) => { value.StopSignal = "SIGQUIT"; },
    (value) => { delete value.Healthcheck; },
    (value) => { value.Healthcheck.Test[3] = "http.get({path:'/api/ready'})"; },
    // These malicious probes still mention /api/health and previously passed
    // the loose path-only contract, but must now be rejected.
    (value) => { value.Healthcheck.Test[3] = "process.exit(0); // path:'/api/health'"; },
    (value) => { value.Healthcheck.Test[3] += ";process.exit(0)"; },
    (value) => { value.Healthcheck.Test[3] = value.Healthcheck.Test[3].replace("statusCode===200", "statusCode>=200"); },
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
