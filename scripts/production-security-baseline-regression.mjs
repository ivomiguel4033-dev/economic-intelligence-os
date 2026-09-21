import assert from "node:assert/strict";
import { validateProductionSecurityBaseline } from "../src/security/production-baseline.ts";

const validEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@db.internal:5432/app",
  OIDC_ISSUER: "https://identity.example.com/tenant",
  OIDC_AUDIENCE: "economic-intelligence-os",
  OIDC_JWKS_URL: "https://identity.example.com/.well-known/jwks.json",
  SECURITY_EVENT_HASH_PEPPER: "0123456789abcdef0123456789abcdef",
};

assert.deepEqual(validateProductionSecurityBaseline(validEnv), { ready: true, failures: [] });

for (const [key, value, expected] of [
  ["OIDC_ISSUER", "http://identity.example.com/tenant", "OIDC_ISSUER must use HTTPS"],
  ["OIDC_JWKS_URL", "http://identity.example.com/jwks.json", "OIDC_JWKS_URL must use HTTPS"],
  ["OIDC_ISSUER", "not-a-url", "OIDC_ISSUER must be a valid URL"],
  ["OIDC_JWKS_URL", "https://user:password@identity.example.com/jwks.json", "OIDC_JWKS_URL must not include credentials"],
  ["OIDC_ISSUER", "https://identity.example.com/tenant#fragment", "OIDC_ISSUER must not include a fragment"],
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

console.log("Production security baseline regression checks passed.");
