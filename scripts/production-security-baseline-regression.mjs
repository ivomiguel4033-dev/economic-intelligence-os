import assert from "node:assert/strict";
import { validateProductionSecurityBaseline } from "../src/security/production-baseline.ts";

const validEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@db.internal:5432/app",
  OIDC_ISSUER: "https://identity.example.com/tenant",
  OIDC_AUDIENCE: "economic-intelligence-os",
  OIDC_JWKS_URL: "https://identity.example.com/.well-known/jwks.json",
  SECURITY_EVENT_HASH_PEPPER: "0123456789abcdef0123456789abcdef",
  METRICS_TOKEN: "abcdef0123456789abcdef0123456789",
};

assert.deepEqual(validateProductionSecurityBaseline(validEnv), { ready: true, failures: [] });
// A JWKS query may be intentional; only issuer identifiers prohibit queries.
assert.deepEqual(validateProductionSecurityBaseline({
  ...validEnv, OIDC_JWKS_URL: "https://identity.example.com/jwks.json?version=1",
}), { ready: true, failures: [] });

for (const [key, value, expected] of [
  ["OIDC_ISSUER", "http://identity.example.com/tenant", "OIDC_ISSUER must use HTTPS"],
  ["OIDC_JWKS_URL", "http://identity.example.com/jwks.json", "OIDC_JWKS_URL must use HTTPS"],
  ["OIDC_ISSUER", "not-a-url", "OIDC_ISSUER must be a valid URL"],
  ["OIDC_JWKS_URL", "https://user:password@identity.example.com/jwks.json", "OIDC_JWKS_URL must not include credentials"],
  ["OIDC_ISSUER", "https://identity.example.com/tenant#fragment", "OIDC_ISSUER must not include a fragment"],
  ["OIDC_ISSUER", "https://identity.example.com/tenant#", "OIDC_ISSUER must not include a fragment"],
  ["OIDC_JWKS_URL", "https://identity.example.com/jwks.json#", "OIDC_JWKS_URL must not include a fragment"],
  ["OIDC_ISSUER", "https://identity.example.com/tenant?", "OIDC_ISSUER must not include query parameters"],
  ["OIDC_ISSUER", "https://identity.example.com/tenant?debug=true", "OIDC_ISSUER must not include query parameters"],
  ["OIDC_ISSUER", "https://identity.example.com\\@attacker.example/tenant", "OIDC_ISSUER must not contain backslashes"],
  ["OIDC_JWKS_URL", "https://identity.example.com\\@attacker.example/jwks.json", "OIDC_JWKS_URL must not contain backslashes"],
]) {
  const result = validateProductionSecurityBaseline({ ...validEnv, [key]: value });
  assert.equal(result.ready, false);
  assert.ok(result.failures.includes(expected), `${key} should fail with: ${expected}`);
}

const insecureOverride = validateProductionSecurityBaseline({ ...validEnv, ALLOW_INSECURE_AUTH: "true" });
assert.equal(insecureOverride.ready, false);
assert.ok(insecureOverride.failures.includes("Insecure authentication override is forbidden in production"));

const weakPepper = validateProductionSecurityBaseline({ ...validEnv, SECURITY_EVENT_HASH_PEPPER: "too-short" });
assert.equal(weakPepper.ready, false);
assert.ok(weakPepper.failures.includes("SECURITY_EVENT_HASH_PEPPER must be at least 32 characters"));

const weakMetricsToken = validateProductionSecurityBaseline({ ...validEnv, METRICS_TOKEN: "too-short" });
assert.equal(weakMetricsToken.ready, false);
assert.ok(weakMetricsToken.failures.includes("METRICS_TOKEN must be at least 32 characters"));

for (const [key, value, expected] of [
  ["SECURITY_EVENT_HASH_PEPPER", validEnv.SECURITY_EVENT_HASH_PEPPER + "\n", "SECURITY_EVENT_HASH_PEPPER must not contain control characters"],
  ["SECURITY_EVENT_HASH_PEPPER", " " + validEnv.SECURITY_EVENT_HASH_PEPPER, "SECURITY_EVENT_HASH_PEPPER must not contain surrounding whitespace"],
  ["METRICS_TOKEN", validEnv.METRICS_TOKEN + "\u007f", "METRICS_TOKEN must not contain control characters"],
  ["METRICS_TOKEN", validEnv.METRICS_TOKEN + " ", "METRICS_TOKEN must not contain surrounding whitespace"],
]) {
  const result = validateProductionSecurityBaseline({ ...validEnv, [key]: value });
  assert.equal(result.ready, false, `${key} must reject malformed secret values`);
  assert.ok(result.failures.includes(expected), `${key} should fail with: ${expected}`);
}

const reusedSecuritySecrets = validateProductionSecurityBaseline({
  ...validEnv,
  METRICS_TOKEN: validEnv.SECURITY_EVENT_HASH_PEPPER,
});
assert.equal(reusedSecuritySecrets.ready, false, "Runtime readiness must reject reused audit and metrics credentials");
assert.ok(reusedSecuritySecrets.failures.includes("SECURITY_EVENT_HASH_PEPPER and METRICS_TOKEN must be distinct"));

const missingMetricsToken = { ...validEnv };
delete missingMetricsToken.METRICS_TOKEN;
const missingMetrics = validateProductionSecurityBaseline(missingMetricsToken);
assert.equal(missingMetrics.ready, false);
assert.ok(missingMetrics.failures.includes("METRICS_TOKEN is required"));

console.log("Production security baseline regression checks passed.");
