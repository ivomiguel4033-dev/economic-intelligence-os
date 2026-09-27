import { validateProductionSecurityBaseline } from "../src/security/production-baseline.ts";

function fail(message) {
  throw new Error(`Production preflight failed: ${message}`);
}

function requireProductionMode(env) {
  if (env.NODE_ENV !== "production") {
    fail("NODE_ENV must be production");
  }
}

function validateProvider(env, prefix, required = false) {
  const keys = [`${prefix}_BASE_URL`, `${prefix}_API_KEY`, `${prefix}_MODEL`];
  const values = keys.map((key) => env[key]?.trim() ?? "");
  const configured = values.filter(Boolean).length;

  if (required && configured === 0) {
    fail(`${prefix} provider is required in production`);
  }
  if (configured !== 0 && configured !== keys.length) {
    fail(`${prefix} provider configuration is incomplete`);
  }
  if (configured === keys.length) {
    const url = new URL(values[0]);
    if (url.protocol !== "https:") fail(`${prefix}_BASE_URL must use HTTPS`);
    if (url.username || url.password) fail(`${prefix}_BASE_URL must not contain credentials`);
  }
}

export function validateProductionPreflight(env = process.env) {
  requireProductionMode(env);

  const baseline = validateProductionSecurityBaseline(env);
  if (!baseline.ready) {
    fail(baseline.failures.join("; "));
  }

  validateProvider(env, "AI_PRIMARY", true);
  validateProvider(env, "AI_SECONDARY");
  validateProvider(env, "AI_TERTIARY");

  return { ready: true };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  validateProductionPreflight();
  console.log("Production preflight checks passed.");
}
