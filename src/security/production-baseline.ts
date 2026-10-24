export interface SecurityBaselineResult {
  ready: boolean;
  failures: string[];
}

function isNonPublicIpv4(host: string): boolean {
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
function isNonPublicIpv6(host: string): boolean {
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

function isUnsafeEndpointHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || isNonPublicIpv4(host) || isNonPublicIpv6(host);
}

function validateHttpsUrl(value: string, label: string, failures: string[]): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") failures.push(`${label} must use HTTPS`);
    if (url.username || url.password) failures.push(`${label} must not include credentials`);
    // Match the preflight restriction on local and non-public literal identity endpoints.
    if (isUnsafeEndpointHostname(url.hostname)) failures.push(`${label} must not use a local hostname`);
    // WHATWG URL parsing normalizes backslashes and hides an empty fragment marker.
    // Match the fail-closed production preflight on the raw configured URL.
    if (value.includes("\\")) failures.push(`${label} must not contain backslashes`);
    if (value.includes("#")) failures.push(`${label} must not include a fragment`);
  } catch {
    failures.push(`${label} must be a valid URL`);
  }
}

export function validateProductionSecurityBaseline(env: NodeJS.ProcessEnv = process.env): SecurityBaselineResult {
  const failures: string[] = [];
  const required = [
    "DATABASE_URL",
    "OIDC_ISSUER",
    "OIDC_AUDIENCE",
    "OIDC_JWKS_URL",
    "SECURITY_EVENT_HASH_PEPPER",
    "METRICS_TOKEN",
  ];
  for (const key of required) if (!env[key]?.trim()) failures.push(`${key} is required`);

  // URL parsing normalizes whitespace and control characters, while JWT
  // issuer/audience comparisons use exact values. Match the deployment preflight.
  for (const key of ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL"]) {
    const value = env[key];
    if (!value) continue;
    if (value !== value.trim()) failures.push(`${key} must not contain surrounding whitespace`);
    if (/[\u0000-\u001f\u007f]/.test(value)) failures.push(`${key} must not contain control characters`);
  }

  if (env.OIDC_ISSUER) {
    validateHttpsUrl(env.OIDC_ISSUER, "OIDC_ISSUER", failures);
    // Issuer identifiers cannot carry query strings, including an empty `?`.
    if (env.OIDC_ISSUER.includes("?")) failures.push("OIDC_ISSUER must not include query parameters");
  }
  if (env.OIDC_JWKS_URL) validateHttpsUrl(env.OIDC_JWKS_URL, "OIDC_JWKS_URL", failures);
  if (env.NODE_ENV === "production" && env.ALLOW_INSECURE_AUTH === "true") failures.push("Insecure authentication override is forbidden in production");
  // Keep runtime readiness aligned with preflight: pasted newlines and
  // surrounding whitespace must not silently become part of long-lived secrets.
  for (const key of ["SECURITY_EVENT_HASH_PEPPER", "METRICS_TOKEN"] as const) {
    const value = env[key];
    if (!value) continue;
    if (/[\u0000-\u001f\u007f]/.test(value)) failures.push(`${key} must not contain control characters`);
    if (value !== value.trim()) failures.push(`${key} must not contain surrounding whitespace`);
  }

  if (env.SECURITY_EVENT_HASH_PEPPER && env.SECURITY_EVENT_HASH_PEPPER.length < 32) failures.push("SECURITY_EVENT_HASH_PEPPER must be at least 32 characters");
  if (env.METRICS_TOKEN && env.METRICS_TOKEN.length < 32) failures.push("METRICS_TOKEN must be at least 32 characters");
  // Keep runtime readiness aligned with pre-deploy checks: these secrets protect
  // different trust boundaries and must never share the same credential.
  if (env.SECURITY_EVENT_HASH_PEPPER && env.METRICS_TOKEN &&
      env.SECURITY_EVENT_HASH_PEPPER === env.METRICS_TOKEN) {
    failures.push("SECURITY_EVENT_HASH_PEPPER and METRICS_TOKEN must be distinct");
  }

  return { ready: failures.length === 0, failures };
}

export function assertProductionSecurityBaseline(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateProductionSecurityBaseline(env);
  if (!result.ready) throw new Error(`Production security baseline failed: ${result.failures.join("; ")}`);
}
