function fail(message) {
  throw new Error(`Production preflight failed: ${message}`);
}

// Reject copied template values that would otherwise satisfy presence checks.
// A configured-but-fake audience, API key or model must never pass preflight.
function isPlaceholder(value) {
  return /^(?:change[-_]?me|replace[-_]?me|placeholder|todo|tbd|undefined|null|none|unknown)$/i.test(value);
}

function validateHttpsUrl(value, label) {
  // WHATWG URL silently removes embedded tabs and newlines; reject raw control bytes first.
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must not contain control characters`);
  // Literal spaces are silently percent-encoded by URL parsing; require explicit encoding.
  if (value.includes(" ")) fail(`${label} must not contain literal spaces`);
  // WHATWG URL normalizes backslashes into slashes for HTTPS URLs; reject raw input.
  if (value.includes("\\")) fail(`${label} must not contain backslashes`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS`);
  // Port zero is reserved and cannot identify a reachable production endpoint.
  if (url.port === "0") fail(`${label} must not use port 0`);
  // WHATWG URL normalizes malformed slash prefixes and strips empty userinfo.
  // Require an explicit HTTPS authority and inspect it before accepting the endpoint.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority) fail(`${label} must include an explicit HTTPS authority`);
  if (authority.includes("@") || url.username || url.password) fail(`${label} must not contain credentials`);
  // URL parsing decodes escaped hostname bytes, which can disguise the configured destination.
  if (authority.includes("%")) fail(`${label} must not contain percent-encoded authority characters`);
  // An empty trailing # is invisible in URL.hash but is still not a valid configured endpoint.
  if (value.includes("#")) fail(`${label} must not include a fragment`);
  return url;
}

// Mirror the runtime provider URL policy's non-public IPv4 ranges at preflight.
function isNonPublicIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second, third] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) || first >= 224;
}

// Match the runtime AI provider policy for non-public IPv6 literal endpoints.
function isNonPublicIpv6(host) {
  const ipv6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (ipv6 === "::" || ipv6 === "::1") return true;
  return /^f[cd][0-9a-f]{2}:/i.test(ipv6) ||
    /^fe[89ab][0-9a-f]:/i.test(ipv6) ||
    /^100:0*:/i.test(ipv6) ||
    /^2001:0*2:/i.test(ipv6) ||
    /^2001:db8:/i.test(ipv6) ||
    /^3fff:/i.test(ipv6) ||
    /^ff[0-9a-f]{2}:/i.test(ipv6) ||
    /^64:ff9b::/i.test(ipv6) ||
    /^64:ff9b:0:0:0:0:/i.test(ipv6) ||
    /^64:ff9b:1:/i.test(ipv6) ||
    /^::ffff:/i.test(ipv6);
}

function isUnsafeEndpointHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return host === "localhost" || host.endsWith(".localhost") ||
    host === "local" || host.endsWith(".local") ||
    host === "localdomain" || host.endsWith(".localdomain") ||
    isNonPublicIpv4(host) || isNonPublicIpv6(host);
}

// Railway databases may use private network addresses, but loopback,
// unspecified and link-local hosts cannot identify the intended remote database.
// Keep RFC1918 addresses available for Railway private networking.
function isUnsafeDatabaseHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  // .local names resolve via mDNS and may target a nearby workstation.
  // Preserve Railway private .internal hostnames while blocking local DNS drift.
  if (host === "localhost" || host.endsWith(".localhost") ||
      host === "local" || host.endsWith(".local") ||
      host === "localdomain" || host.endsWith(".localdomain") ||
      host === "[::]" || host === "[::1]" || /^\[fe[89ab][0-9a-f]:/i.test(host)) {
    return true;
  }
  // URL.hostname canonicalizes IPv4-mapped IPv6 literals into hex hextets.
  // Do not let a mapped loopback, unspecified or link-local IPv4 address
  // bypass the migration endpoint safety gate.
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i.exec(host);
  if (mapped) {
    const upper = parseInt(mapped[1], 16);
    const first = upper >>> 8;
    const second = upper & 255;
    return first === 0 || first === 127 || (first === 169 && second === 254);
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 0 || first === 127 || (first === 169 && second === 254);
}

function validateDatabaseUrl(value) {
  // WHATWG URL removes embedded tab/newline bytes before parsing; fail closed.
  if (/[\u0000-\u001f\u007f]/.test(value)) fail("DATABASE_URL must not contain control characters");
  // PostgreSQL URL parsing can encode a backslash in the authority or preserve it in the path.
  if (value.includes("\\")) fail("DATABASE_URL must not contain backslashes");
  // WHATWG URL silently converts literal spaces in credentials, paths and options to %20.
  // Require explicit encoding so migration targets cannot change during parsing.
  if (value.includes(" ")) fail("DATABASE_URL must not contain literal spaces");
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
  if (isUnsafeDatabaseHostname(url.hostname)) fail("DATABASE_URL must not use a loopback or link-local hostname");
  // Reject unusable database endpoints before attempting production migrations.
  if (url.port === "0") fail("DATABASE_URL must not use port 0");
  if (!url.pathname || url.pathname === "/") fail("DATABASE_URL must include a database name");
  if (value.includes("#")) fail("DATABASE_URL must not include a fragment");
  // Query parameters must not redefine the connection identity or override
  // migration search_path via PostgreSQL startup options. Preserve safe
  // transport options such as sslmode=require for Railway.
  const forbiddenConnectionKeys = new Set([
    "host", "hostaddr", "port", "user", "username", "password",
    "database", "dbname", "service", "passfile", "options",
  ]);
  // Duplicate keys (including case or percent-encoded variants) are ambiguous:
  // clients may choose the first or last value for security-sensitive options
  // such as sslmode. Never approve migrations with conflicting connection settings.
  const seenQueryKeys = new Set();
  // URLSearchParams silently replaces malformed percent-encoded UTF-8 with U+FFFD.
  // Fail before parsing options so pg never receives a different connection setting.
  try {
    decodeURIComponent(url.search.slice(1));
  } catch {
    fail("DATABASE_URL query parameters must use valid percent-encoding");
  }
  // URLSearchParams decodes percent-encoded bytes before the PostgreSQL driver
  // sees them. Reject hidden control characters in option names and values.
  for (const [key, optionValue] of url.searchParams) {
    if (/[\u0000-\u001f\u007f]/.test(key) || /[\u0000-\u001f\u007f]/.test(optionValue)) {
      fail("DATABASE_URL query parameters must not contain control characters");
    }
    const normalizedKey = key.toLowerCase();
    if (seenQueryKeys.has(normalizedKey)) {
      fail("DATABASE_URL query parameters must not repeat keys");
    }
    seenQueryKeys.add(normalizedKey);
    if (forbiddenConnectionKeys.has(normalizedKey)) {
      fail("DATABASE_URL query parameters must not override connection identity");
    }
  }
  // The URL parser leaves percent-encoding in the pathname. Reject database
  // names that decode to whitespace, control bytes or invalid UTF-8 before
  // migrations can connect to an unintended database.
  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail("DATABASE_URL database name must use valid percent-encoding");
  }
  if (/[\u0000-\u001f\u007f]/.test(databaseName)) {
    fail("DATABASE_URL database name must not contain control characters");
  }
  if (!databaseName.trim()) fail("DATABASE_URL must include a nonblank database name");
  // A name with leading/trailing decoded whitespace can silently select a different database.
  // Preserve valid interior spaces, but reject accidental padding in Railway configuration.
  if (databaseName !== databaseName.trim()) {
    fail("DATABASE_URL database name must not contain surrounding whitespace");
  }
  // Railway production migrations must authenticate explicitly; implicit local
  // PostgreSQL credentials can silently target the wrong database identity.
  // URL.username/password remain percent-encoded. Decode once to reject
  // whitespace-only credentials and malformed escapes before pg parses them.
  let username;
  let password;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    fail("DATABASE_URL credentials must use valid percent-encoding");
  }
  // Report encoded control characters before checking blank credentials:
  // a decoded newline is both whitespace and a forbidden control byte.
  if (/[\u0000-\u001f\u007f]/.test(username) || /[\u0000-\u001f\u007f]/.test(password)) {
    fail("DATABASE_URL credentials must not contain control characters");
  }
  if (!username.trim() || !password.trim()) {
    fail("DATABASE_URL must include explicit username and password");
  }
  // Encoded leading/trailing whitespace can silently change the database login.
  // Keep legitimate interior spaces in usernames and passwords untouched.
  if (username !== username.trim() || password !== password.trim()) {
    fail("DATABASE_URL credentials must not contain surrounding whitespace");
  }
  // A nonempty template credential can pass presence checks yet make the
  // first Railway migration fail authentication. Decode before checking so
  // percent-encoded placeholders cannot bypass the production gate.
  if (isPlaceholder(username) || isPlaceholder(password)) {
    fail("DATABASE_URL credentials must not be placeholders");
  }
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

  // URL parsing silently normalizes surrounding whitespace and embedded
  // control characters, while OIDC issuer/audience matching uses exact values.
  for (const key of ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"]) {
    const value = env[key];
    if (value !== value.trim()) fail(`${key} must not contain surrounding whitespace`);
    if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${key} must not contain control characters`);
  }

  if (isPlaceholder(env.OIDC_AUDIENCE)) {
    fail("OIDC_AUDIENCE must not be a placeholder");
  }

  validateDatabaseUrl(env.DATABASE_URL);
  const issuerUrl = validateHttpsUrl(env.OIDC_ISSUER, "OIDC_ISSUER");
  // Production token issuers must not point to local or non-public literal endpoints.
  if (isUnsafeEndpointHostname(issuerUrl.hostname)) {
    fail("OIDC_ISSUER must not use a local hostname");
  }
  // OpenID Connect issuer identifiers must not include query components.
  if (env.OIDC_ISSUER.includes("?")) fail("OIDC_ISSUER must not include query parameters");
  const jwksUrl = validateHttpsUrl(env.OIDC_JWKS_URL, "OIDC_JWKS_URL");
  // Never fetch JWKS from loopback, link-local, or other non-public IPv4 endpoints.
  if (isUnsafeEndpointHostname(jwksUrl.hostname)) {
    fail("OIDC_JWKS_URL must not use a local hostname");
  }

  if (env.ALLOW_INSECURE_AUTH === "true") {
    fail("Insecure authentication override is forbidden in production");
  }
  // Reject invisible bytes in long-lived production secrets before checking length.
  // They can be silently introduced by environment-variable copy/paste or templating.
  for (const key of ["SECURITY_EVENT_HASH_PEPPER", "METRICS_TOKEN"]) {
    const value = env[key];
    if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${key} must not contain control characters`);
    if (value !== value.trim()) fail(`${key} must not contain surrounding whitespace`);
  }
  if (env.SECURITY_EVENT_HASH_PEPPER.length < 32) {
    fail("SECURITY_EVENT_HASH_PEPPER must be at least 32 characters");
  }
  if (env.METRICS_TOKEN.length < 32) {
    fail("METRICS_TOKEN must be at least 32 characters");
  }
  // Length alone is not sufficient: uniform values such as 32 x's are
  // common copy/paste fixtures and offer effectively no secret entropy.
  for (const key of ["SECURITY_EVENT_HASH_PEPPER", "METRICS_TOKEN"]) {
    if (/^(.)\1+$/u.test(env[key])) {
      fail(`${key} must not consist of a single repeated character`);
    }
    // A short repeating motif (e.g. abcdabcd...) is still a predictable
    // fixture, despite passing minimum length and uniform-character checks.
    if (/^(.{2,8})\1+$/u.test(env[key])) {
      fail(`${key} must not consist of a repeated short pattern`);
    }
  }
  // These protect separate trust boundaries; reusing a token as the audit
  // hash pepper lets a leaked metrics credential compromise audit pseudonyms.
  if (env.SECURITY_EVENT_HASH_PEPPER === env.METRICS_TOKEN) {
    fail("SECURITY_EVENT_HASH_PEPPER and METRICS_TOKEN must be distinct");
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
      if (/[\u0000-\u001f\u007f]/.test(values[index])) {
        fail(`${keys[index]} must not contain control characters`);
      }
      if (values[index] !== values[index].trim()) {
        fail(`${keys[index]} must not contain surrounding whitespace`);
      }
      if (index > 0 && isPlaceholder(values[index])) {
        fail(`${keys[index]} must not be a placeholder`);
      }
    }
    // Provider credentials must not double as audit or metrics credentials.
    // A leaked AI key must never grant access to observability or audit pseudonyms.
    if (values[1] === env.SECURITY_EVENT_HASH_PEPPER || values[1] === env.METRICS_TOKEN) {
      fail(`${prefix}_API_KEY must be distinct from audit and metrics secrets`);
    }
    const url = validateHttpsUrl(values[0], `${prefix}_BASE_URL`);
    if (values[0].includes("?")) fail(`${prefix}_BASE_URL must not include query parameters`);
    // Keep AI provider and JWKS endpoint restrictions aligned.
    if (isUnsafeEndpointHostname(url.hostname)) {
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
