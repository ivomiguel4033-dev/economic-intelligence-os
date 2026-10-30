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
  // value while another uses the last. Compare names case-insensitively so
  // deployment tooling that folds case cannot silently change which value wins.
  const seenEnvironmentNames = new Set();
  for (const entry of config.Env) {
    assert.equal(typeof entry, "string", "Production image environment entries must be strings");
    // Control bytes in image-baked values can forge multiline logs or be
    // interpreted differently by startup scripts and deployment tooling.
    assert.ok(!/[\u0000-\u001f\u007f]/.test(entry),
      "Production image environment entries must not contain control characters");
    const separator = entry.indexOf("=");
    const name = separator >= 0 ? entry.slice(0, separator) : "";
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Production image environment entries must use valid NAME=value syntax");
    const normalizedName = name.toUpperCase();
    assert.ok(!seenEnvironmentNames.has(normalizedName),
      `Production image must not define duplicate environment variable ${name}`);
    seenEnvironmentNames.add(normalizedName);
  }
  for (const variable of ["NODE_ENV=production", "PORT=3000"]) {
    assert.ok(config.Env.includes(variable), `Production image is missing ${variable}`);
  }
  // These image-level environment variables are inherited by the web process
  // and pre-deploy commands. A release artifact must not ship with Node
  // inspector/preload/debug/coverage overrides or disabled TLS verification.
  // NODE_PATH can redirect CommonJS module loading, while npm's script-shell
  // and node-options settings can change how Railway runs pre-deploy migrations.
  // Even a seemingly safe TLS value belongs to deployment policy, not the
  // reusable image. Reject case variants and module/script execution overrides
  // so image metadata cannot silently override runtime security.
  for (const variable of config.Env) {
    const name = variable.split("=", 1)[0];
    assert.ok(!/^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_DEBUG|NODE_DEBUG_NATIVE|NODE_V8_COVERAGE|NODE_PATH|NPM_CONFIG_SCRIPT_SHELL|NPM_CONFIG_NODE_OPTIONS)$/i.test(name),
      `Production image must not bake Node runtime override ${name}`);
  }
  // The Alpine dynamic loader can preload arbitrary shared objects or resolve
  // libraries from attacker-controlled paths before the Node process starts.
  // Keep linker injection and debug overrides out of the reusable release image.
  // These are deployment-time decisions, never safe baked-in defaults.
  for (const variable of config.Env) {
    const name = variable.split("=", 1)[0];
    assert.ok(!/^(?:LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|LD_DEBUG)$/i.test(name),
      `Production image must not bake dynamic linker override ${name}`);
  }
  // OIDC discovery and AI provider calls must not inherit image-baked proxy
  // routing or custom TLS trust anchors. This includes OpenSSL trust-store
  // overrides, Node's system-CA switch and OpenSSL configuration/provider\n  // injection, which can change OIDC/AI TLS trust and cryptographic behavior.
  // Operators may inject these settings explicitly at runtime, but a reusable
  // release image must not carry them.
  const networkOverrides = /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|NODE_USE_SYSTEM_CA|OPENSSL_CONF|OPENSSL_MODULES)$/i;
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
  // future provider/OIDC, security and metrics secrets not yet enumerated in the application code.
  // Railway platform credentials, cloud AI SDK credentials and automation
  // tokens must also be injected at deployment time, never baked into the image.
  // Case variants are still deployment-specific and may contain credentials;
  // reject them before a future consumer or entrypoint normalizes their names.
  const runtimeOnly = /^(?:DATABASE_[A-Z0-9_]+|PG[A-Z0-9_]+|OIDC_[A-Z0-9_]+|SECURITY_[A-Z0-9_]+|METRICS_[A-Z0-9_]+|AI_[A-Z0-9_]+|STRIPE_[A-Z0-9_]+|RAILWAY_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+|ANTHROPIC_[A-Z0-9_]+|AWS_[A-Z0-9_]+|AZURE_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+|GCP_[A-Z0-9_]+|MISTRAL_[A-Z0-9_]+|COHERE_[A-Z0-9_]+|GROQ_[A-Z0-9_]+|HUGGINGFACE_[A-Z0-9_]+|HF_TOKEN|TOGETHER_[A-Z0-9_]+|DEEPSEEK_[A-Z0-9_]+|FIREWORKS_[A-Z0-9_]+|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN)$/i;
  for (const variable of config.Env) {
    const name = variable.split("=", 1)[0];
    assert.ok(!runtimeOnly.test(name),
      `Production image must not bake deployment-specific ${name}`);
  }
  assert.deepEqual(Object.keys(config.ExposedPorts ?? {}), ["3000/tcp"],
    "Production image must expose only the application port");
  // Docker VOLUME creates storage outside the immutable release image. Accidental
  // anonymous volumes can retain stale application assets or migration state
  // across deployments and undermine predictable rollback/recovery behavior.
  // Production persistence must be configured explicitly by the platform.
  assert.equal(Object.keys(config.Volumes ?? {}).length, 0,
    "Production image must not declare persistent volumes");
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
  // Docker supports a faster healthcheck cadence during the startup grace
  // period. Reject sub-5s probe storms and intervals longer than the 20s
  // grace window, which would undermine bounded startup health observation.
  // Zero is Docker's unset sentinel; the engine then applies its default.
  const startInterval = probe.StartInterval;
  assert.ok(startInterval == null || startInterval === 0 ||
    (Number.isInteger(startInterval) && startInterval >= 5_000_000_000 &&
      startInterval <= 20_000_000_000),
    "Production healthcheck start interval must be unset or between 5s and 20s");
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
  validate({ ...fixture, Env: [...fixture.Env, "APP_LOG_LEVEL=info", "APP_TRACE_MODE=off"] });
  validate({ ...fixture, Volumes: {} });
  // Both Docker's implicit default and an explicit SIGTERM are safe.
  validate({ ...fixture, StopSignal: "SIGTERM" });
  validate({ ...fixture, StopTimeout: 30 });
  validate({ ...fixture, StopTimeout: 120 });
  for (const timeout of [0, 1, 29, -1, 30.5, "30", 121, Infinity]) {
    assert.throws(() => validate({ ...fixture, StopTimeout: timeout }),
      /stop timeout must allow 30-120s/,
      `Unsafe Docker StopTimeout ${String(timeout)} must block promotion`);
  }
  // Docker image healthchecks must not overload a starting Railway service
  // or defer all startup probes beyond the configured 20-second grace period.
  validate({ ...fixture, Healthcheck: { ...fixture.Healthcheck, StartInterval: 0 } });
  validate({ ...fixture, Healthcheck: { ...fixture.Healthcheck, StartInterval: 5_000_000_000 } });
  validate({ ...fixture, Healthcheck: { ...fixture.Healthcheck, StartInterval: 20_000_000_000 } });
  for (const startInterval of [-1, 1_000_000_000, 4_999_999_999, 20_000_000_001, 30_000_000_000, 5.5, "5000000000", Infinity]) {
    assert.throws(
      () => validate({ ...fixture, Healthcheck: { ...fixture.Healthcheck, StartInterval: startInterval } }),
      /start interval must be unset or between 5s and 20s/,
      `Unsafe Docker StartInterval ${String(startInterval)} must block promotion`,
    );
  }
  for (const mutate of [
    (value) => { value.User = "root"; },
    (value) => { value.Env.push("NODE_OPTIONS=--inspect=0.0.0.0:9229"); },
    (value) => { value.Env.push("node_options=--require /tmp/preload.js"); },
    (value) => { value.Env.push("NODE_TLS_REJECT_UNAUTHORIZED=0"); },
    (value) => { value.Env.push("NODE_TLS_REJECT_UNAUTHORIZED=1"); },
    (value) => { value.Env.push("node_tls_reject_unauthorized=0"); },
    // Image-baked Node debug and coverage hooks can leak OIDC/AI secrets to logs
    // or write unexpected artifacts during startup and pre-deploy migrations.
    ...["NODE_DEBUG", "node_debug_native", "NODE_V8_COVERAGE"].map(
      (name) => (value) => { value.Env.push(`${name}=http,tls`); },
    ),
    // Module search paths and npm pre-deploy script execution must not be
    // redirected by reusable image metadata, even with mixed-case names.
    ...["NODE_PATH", "node_path", "NPM_CONFIG_SCRIPT_SHELL", "npm_config_script_shell", "npm_config_node_options"].map(
      (name) => (value) => { value.Env.push(`${name}=/tmp/untrusted`); },
    ),
    ...["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "ssl_cert_dir", "NODE_USE_SYSTEM_CA", "OPENSSL_CONF", "openssl_conf", "OPENSSL_MODULES", "openssl_modules"].map(
      (name) => (value) => { value.Env.push(`${name}=https://untrusted-proxy.example`); },
    ),
    // Linker injection can execute untrusted code before Node's own guards run.
    ...["LD_PRELOAD", "ld_preload", "LD_LIBRARY_PATH", "ld_library_path", "LD_AUDIT", "LD_DEBUG"].map(
      (name) => (value) => { value.Env.push(`${name}=/tmp/untrusted.so`); },
    ),
    (value) => { value.Env.push("NODE_ENV=development"); },
    (value) => { value.Env.push("PORT=8080"); },
    (value) => { value.Env.push("NEXT_TELEMETRY_DISABLED=0"); },
    (value) => { value.Env.push("BROKEN_ENTRY"); },
    (value) => { value.Env.push("APP_LOG_LEVEL=info\nNODE_OPTIONS=--inspect"); },
    (value) => { value.Env.push("APP_LOG_LEVEL=info\u0000debug"); },
    (value) => { value.Env.push("APP_LOG_LEVEL=info\u007fdebug"); },
    (value) => { value.Env.push("=empty-name"); },
    (value) => { value.Env.push("INVALID-NAME=value"); },
    (value) => { value.Env.push("PATH=/tmp"); value.Env.push("PATH=/usr/bin"); },
    // Case-folding in deployment tooling must not turn two distinct image
    // entries into a conflicting effective runtime variable.
    (value) => { value.Env.push("port=8080"); },
    (value) => { value.Env.push("Node_Env=development"); },
    (value) => { value.Env.push("APP_LOG_LEVEL=info"); value.Env.push("app_log_level=debug"); },
    (value) => { value.Env = value.Env.filter((entry) => entry !== "NEXT_TELEMETRY_DISABLED=1"); },
    ...["DATABASE_URL", "DATABASE_READ_REPLICA_URL", "PGPASSWORD", "PGHOST", "OIDC_ISSUER", "OIDC_JWKS_URL", "OIDC_CLIENT_SECRET", "AI_PRIMARY_API_KEY", "AI_TERTIARY_API_KEY", "AI_TERTIARY_BASE_URL", "AI_TERTIARY_TIMEOUT_MS", "AI_FALLBACK_BASE_URL", "METRICS_TOKEN", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_KEY"].map(
      (name) => (value) => { value.Env.push(`${name}=test-value`); },
    ),
    // Provider SDK credentials, GitHub automation tokens and npm publish tokens
    // must be supplied at runtime rather than embedded in a reusable Docker image.
    ...["AZURE_OPENAI_API_KEY", "azure_client_secret", "GOOGLE_APPLICATION_CREDENTIALS",
      "google_api_key", "GCP_SERVICE_ACCOUNT", "gcp_project",
      // AI vendor SDK credentials must never be baked into a reusable release image.
      "MISTRAL_API_KEY", "mistral_endpoint", "COHERE_API_KEY", "cohere_api_key",
      "GROQ_API_KEY", "groq_base_url", "HUGGINGFACE_HUB_TOKEN", "huggingface_api_key",
      "HF_TOKEN", "hf_token", "TOGETHER_API_KEY", "together_base_url",
      "DEEPSEEK_API_KEY", "deepseek_base_url", "FIREWORKS_API_KEY", "fireworks_api_key",
      "GITHUB_TOKEN",
      "github_token", "GH_TOKEN", "gh_token", "NPM_TOKEN", "npm_token"].map(
      (name) => (value) => { value.Env.push(`${name}=test-secret`); },
    ),
    // Mixed/lowercase secret names must not bypass image-level redaction.
    ...["database_url", "pgpassword", "oidc_issuer", "Ai_Primary_Api_Key", "stripe_webhook_secret", "metrics_token", "security_event_hash_pepper", "security_session_signing_key", "METRICS_SCRAPE_TOKEN", "RAILWAY_TOKEN", "railway_environment", "OPENAI_API_KEY", "openai_organization", "ANTHROPIC_API_KEY", "anthropic_base_url", "AWS_ACCESS_KEY_ID", "aws_secret_access_key"].map(
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
    // Stateful image-declared volumes are incompatible with deterministic
    // rolling deploys and rollbacks; Railway-managed volumes are separate.
    ...["/app", "/app/.next", "/app/db"].map(
      (mount) => (value) => { value.Volumes = { [mount]: {} }; },
    ),
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
