function fail(message) {
  throw new Error(`Production preflight failed: ${message}`);
}

function validateHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS`);
  if (url.username || url.password) fail(`${label} must not contain credentials`);
  if (url.hash) fail(`${label} must not include a fragment`);
  return url;
}

function validateDatabaseUrl(value) {
  if (value !== value.trim()) fail("DATABASE_URL must not contain surrounding whitespace");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("DATABASE_URL must be a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail("DATABASE_URL must use postgres:// or postgresql://");
  }
  if (!url.hostname) fail("DATABASE_URL must include a hostname");
  if (!url.pathname || url.pathname === "/") fail("DATABASE_URL must include a database name");
  if (url.hash) fail("DATABASE_URL must not include a fragment");
}

function validateSecurityBaseline(env) {
  const required = [
    "DATABASE_URL",
    "OIDC_ISSUER",
    "OIDC_AUDIENCE",
    "OIDC_JWKS_URL",
    "SECURITY_EVENT_HASH_PEPPER",
    "METRICS_TOKEN",
  ];

  for (const key of required) {
    if (!env[key]?.trim()) fail(`${key} is required`);
  }

  validateDatabaseUrl(env.DATABASE_URL);
  validateHttpsUrl(env.OIDC_ISSUER, "OIDC_ISSUER");
  validateHttpsUrl(env.OIDC_JWKS_URL, "OIDC_JWKS_URL");

  if (env.ALLOW_INSECURE_AUTH === "true") {
    fail("Insecure authentication override is forbidden in production");
  }
  if (env.SECURITY_EVENT_HASH_PEPPER.length < 32) {
    fail("SECURITY_EVENT_HASH_PEPPER must be at least 32 characters");
  }
  if (env.METRICS_TOKEN.length < 32) {
    fail("METRICS_TOKEN must be at least 32 characters");
  }
}

function requireProductionMode(env) {
  if (env.NODE_ENV !== "production") {
    fail("NODE_ENV must be production");
  }
}

function validateProvider(env, prefix, required = false) {
  const keys = [`${prefix}_BASE_URL`, `${prefix}_API_KEY`, `${prefix}_MODEL`];
  // Preserve raw values so preflight and the runtime reject the same inputs.
  const values = keys.map((key) => env[key] ?? "");
  const configured = values.filter((value) => value.length > 0).length;

  if (required && configured === 0) {
    fail(`${prefix} provider is required in production`);
  }
  if (configured !== 0 && configured !== keys.length) {
    fail(`${prefix} provider configuration is incomplete`);
  }
  if (configured === keys.length) {
    for (let index = 0; index < keys.length; index++) {
      if (!values[index].trim()) fail(`${keys[index]} must not be blank`);
      if (values[index] !== values[index].trim()) {
        fail(`${keys[index]} must not contain surrounding whitespace`);
      }
    }
    const url = validateHttpsUrl(values[0], `${prefix}_BASE_URL`);
    if (url.search) fail(`${prefix}_BASE_URL must not include query parameters`);
    const host = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      fail(`${prefix}_BASE_URL must not use a local hostname`);
    }
  }
}

export function validateProductionPreflight(env = process.env) {
  requireProductionMode(env);
  validateSecurityBaseline(env);
  validateProvider(env, "AI_PRIMARY", true);
  validateProvider(env, "AI_SECONDARY");
  validateProvider(env, "AI_TERTIARY");
  return { ready: true };
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === new URL(`file://${invokedPath}`).href) {
  validateProductionPreflight();
  console.log("Production preflight checks passed.");
}
