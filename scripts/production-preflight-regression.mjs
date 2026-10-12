import assert from "node:assert/strict";
import { validateProductionPreflight } from "./production-preflight.mjs";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:fixture@db.internal:5432/app",
  OIDC_ISSUER: "https://identity.example.com/tenant",
  OIDC_AUDIENCE: "economic-intelligence-os",
  OIDC_JWKS_URL: "https://identity.example.com/.well-known/jwks.json",
  SECURITY_EVENT_HASH_PEPPER: "x".repeat(32),
  METRICS_TOKEN: "y".repeat(32),
  AI_PRIMARY_BASE_URL: "https://api.example.com/v1",
  AI_PRIMARY_API_KEY: "fixture-key",
  AI_PRIMARY_MODEL: "reasoning-model",
};

assert.deepEqual(validateProductionPreflight(base), { ready: true });
assert.deepEqual(validateProductionPreflight({ ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }), { ready: true });
assert.deepEqual(
  validateProductionPreflight({ ...base, DATABASE_URL: "postgres://app:fixture@db.internal:5432/app?sslmode=require" }),
  { ready: true },
);

for (const [name, env, expected] of [
  ["production mode", { ...base, NODE_ENV: "development" }, "NODE_ENV must be production"],
  ["database URL scheme", { ...base, DATABASE_URL: "https://db.internal/app" }, "DATABASE_URL must use postgres:// or postgresql://"],
  ["database URL malformed", { ...base, DATABASE_URL: "not-a-url" }, "DATABASE_URL must be a valid URL"],
  ["database URL missing host", { ...base, DATABASE_URL: "postgresql:///app" }, "DATABASE_URL must include a hostname"],
  ["database URL missing database", { ...base, DATABASE_URL: "postgresql://db.internal" }, "DATABASE_URL must include a database name"],
  ["database URL fragment", { ...base, DATABASE_URL: "postgresql://db.internal/app#fragment" }, "DATABASE_URL must not include a fragment"],
  ["database URL whitespace", { ...base, DATABASE_URL: " postgresql://db.internal/app" }, "DATABASE_URL must not contain surrounding whitespace"],
  ["database URL embedded tab", { ...base, DATABASE_URL: "postgresql://db.internal/\tapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL embedded newline", { ...base, DATABASE_URL: "postgresql://db.internal/\napp" }, "DATABASE_URL must not contain control characters"],
  ["database URL embedded carriage return", { ...base, DATABASE_URL: "postgresql://db.internal/\rapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL DEL control", { ...base, DATABASE_URL: "postgresql://db.internal/\u007fapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL NUL control", { ...base, DATABASE_URL: "postgresql://db.internal/\u0000app" }, "DATABASE_URL must not contain control characters"],
  ["missing primary", (() => {
    const copy = { ...base };
    delete copy.AI_PRIMARY_BASE_URL;
    delete copy.AI_PRIMARY_API_KEY;
    delete copy.AI_PRIMARY_MODEL;
    return copy;
  })(), "AI_PRIMARY provider is required in production"],
  ["partial secondary", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1" }, "AI_SECONDARY provider configuration is incomplete"],
  ["insecure provider", { ...base, AI_PRIMARY_BASE_URL: "http://api.example.com/v1" }, "AI_PRIMARY_BASE_URL must use HTTPS"],
  ["provider leading whitespace", { ...base, AI_PRIMARY_BASE_URL: " https://api.example.com/v1" }, "AI_PRIMARY_BASE_URL must not contain surrounding whitespace"],
  ["provider embedded tab", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\tv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider embedded newline", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\nv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider embedded carriage return", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\rv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider DEL control", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\u007fv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["secondary provider control", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/\tv1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not contain control characters"],
  ["provider key trailing whitespace", { ...base, AI_PRIMARY_API_KEY: "fixture-key " }, "AI_PRIMARY_API_KEY must not contain surrounding whitespace"],
  ["provider blank model", { ...base, AI_PRIMARY_MODEL: "   " }, "AI_PRIMARY_MODEL must not be blank"],
  ["provider query", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/v1?token=unsafe" }, "AI_PRIMARY_BASE_URL must not include query parameters"],
  ["primary localhost", { ...base, AI_PRIMARY_BASE_URL: "https://localhost/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["primary localhost subdomain", { ...base, AI_PRIMARY_BASE_URL: "https://ai.localhost/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["secondary local domain", { ...base, AI_SECONDARY_BASE_URL: "https://model.internal.local/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not use a local hostname"],
]) {
  assert.throws(
    () => validateProductionPreflight(env),
    (error) => error instanceof Error && error.message.includes(expected),
    `${name} must fail with ${expected}`,
  );
}

console.log("Production preflight regression checks passed.");
