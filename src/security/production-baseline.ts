export interface SecurityBaselineResult {
  ready: boolean;
  failures: string[];
}

function validateHttpsUrl(value: string, label: string, failures: string[]): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") failures.push(`${label} must use HTTPS`);
    if (url.username || url.password) failures.push(`${label} must not include credentials`);
    if (url.hash) failures.push(`${label} must not include a fragment`);
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
  ];
  for (const key of required) if (!env[key]) failures.push(`${key} is required`);

  if (env.OIDC_ISSUER) validateHttpsUrl(env.OIDC_ISSUER, "OIDC_ISSUER", failures);
  if (env.OIDC_JWKS_URL) validateHttpsUrl(env.OIDC_JWKS_URL, "OIDC_JWKS_URL", failures);
  if (env.NODE_ENV === "production" && env.ALLOW_INSECURE_AUTH === "true") failures.push("Insecure authentication override is forbidden in production");
  if (env.SECURITY_EVENT_HASH_PEPPER && env.SECURITY_EVENT_HASH_PEPPER.length < 32) failures.push("SECURITY_EVENT_HASH_PEPPER must be at least 32 characters");

  return { ready: failures.length === 0, failures };
}

export function assertProductionSecurityBaseline(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateProductionSecurityBaseline(env);
  if (!result.ready) throw new Error(`Production security baseline failed: ${result.failures.join("; ")}`);
}
