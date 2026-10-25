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
// An @ in the URL path is not an authority credential marker.
assert.deepEqual(validateProductionPreflight({ ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/v1/@model" }), { ready: true });
// Percent-encoded punctuation is valid in a PostgreSQL password.
assert.deepEqual(validateProductionPreflight({ ...base, DATABASE_URL: "postgresql://app:pa%40ss@db.internal/app" }), { ready: true });
// Explicitly encoded interior spaces in PostgreSQL credentials remain valid.
assert.deepEqual(validateProductionPreflight({ ...base, DATABASE_URL: "postgresql://app%20user:pass%20word@db.internal/app" }), { ready: true });
// Internal spaces in an explicitly encoded PostgreSQL database name remain valid.
assert.deepEqual(validateProductionPreflight({ ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/report%20archive" }), { ready: true });
// Legitimate credentials containing a placeholder substring are not templates.
assert.deepEqual(validateProductionPreflight({ ...base, DATABASE_URL: "postgresql://app:todo-service@db.internal/app" }), { ready: true });
assert.deepEqual(validateProductionPreflight({ ...base, AI_PRIMARY_BASE_URL: "https://8.8.8.8/v1" }), { ready: true });
assert.deepEqual(validateProductionPreflight({ ...base, OIDC_JWKS_URL: "https://8.8.8.8/keys" }), { ready: true });
assert.deepEqual(validateProductionPreflight({ ...base, OIDC_ISSUER: "https://8.8.8.8/tenant" }), { ready: true });
assert.deepEqual(validateProductionPreflight({ ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }), { ready: true });
assert.deepEqual(
  validateProductionPreflight({ ...base, DATABASE_URL: "postgres://app:fixture@db.internal:5432/app?sslmode=require" }),
  { ready: true },
);

for (const [name, env, expected] of [
  ["OIDC audience template", { ...base, OIDC_AUDIENCE: "CHANGE_ME" }, "OIDC_AUDIENCE must not be a placeholder"],
  ["OIDC audience unknown", { ...base, OIDC_AUDIENCE: "unknown" }, "OIDC_AUDIENCE must not be a placeholder"],
  ["primary AI key template", { ...base, AI_PRIMARY_API_KEY: "replace_me" }, "AI_PRIMARY_API_KEY must not be a placeholder"],
  ["primary AI model template", { ...base, AI_PRIMARY_MODEL: "TODO" }, "AI_PRIMARY_MODEL must not be a placeholder"],
  ["secondary AI key template", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1", AI_SECONDARY_API_KEY: "placeholder", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_API_KEY must not be a placeholder"],
  ["tertiary AI model template", { ...base, AI_TERTIARY_BASE_URL: "https://third.example.com/v1", AI_TERTIARY_API_KEY: "backup-key", AI_TERTIARY_MODEL: "tbd" }, "AI_TERTIARY_MODEL must not be a placeholder"],
  ["audit pepper embedded newline", { ...base, SECURITY_EVENT_HASH_PEPPER: "x".repeat(32) + "\n" }, "SECURITY_EVENT_HASH_PEPPER must not contain control characters"],
  ["audit pepper leading whitespace", { ...base, SECURITY_EVENT_HASH_PEPPER: " " + "x".repeat(32) }, "SECURITY_EVENT_HASH_PEPPER must not contain surrounding whitespace"],
  ["metrics token DEL byte", { ...base, METRICS_TOKEN: "y".repeat(32) + "\u007f" }, "METRICS_TOKEN must not contain control characters"],
  ["metrics token trailing whitespace", { ...base, METRICS_TOKEN: "y".repeat(32) + " " }, "METRICS_TOKEN must not contain surrounding whitespace"],
  ["reused security secrets", { ...base, METRICS_TOKEN: base.SECURITY_EVENT_HASH_PEPPER }, "SECURITY_EVENT_HASH_PEPPER and METRICS_TOKEN must be distinct"],
  ["primary key reused as metrics token", { ...base, AI_PRIMARY_API_KEY: base.METRICS_TOKEN }, "AI_PRIMARY_API_KEY must be distinct from audit and metrics secrets"],
  ["primary key reused as audit pepper", { ...base, AI_PRIMARY_API_KEY: base.SECURITY_EVENT_HASH_PEPPER }, "AI_PRIMARY_API_KEY must be distinct from audit and metrics secrets"],
  ["secondary key reused as metrics token", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1", AI_SECONDARY_API_KEY: base.METRICS_TOKEN, AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_API_KEY must be distinct from audit and metrics secrets"],
  ["tertiary key reused as audit pepper", { ...base, AI_TERTIARY_BASE_URL: "https://backup.example.com/v1", AI_TERTIARY_API_KEY: base.SECURITY_EVENT_HASH_PEPPER, AI_TERTIARY_MODEL: "backup-model" }, "AI_TERTIARY_API_KEY must be distinct from audit and metrics secrets"],
  ["production mode", { ...base, NODE_ENV: "development" }, "NODE_ENV must be production"],
  ["database URL scheme", { ...base, DATABASE_URL: "https://db.internal/app" }, "DATABASE_URL must use postgres:// or postgresql://"],
  ["database URL malformed", { ...base, DATABASE_URL: "not-a-url" }, "DATABASE_URL must be a valid URL"],
  ["database URL missing host", { ...base, DATABASE_URL: "postgresql:///app" }, "DATABASE_URL must include a hostname"],
  ["database URL missing database", { ...base, DATABASE_URL: "postgresql://db.internal" }, "DATABASE_URL must include a database name"],
  ["database URL port zero", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal:0/app" }, "DATABASE_URL must not use port 0"],
  ["database URL fragment", { ...base, DATABASE_URL: "postgresql://db.internal/app#fragment" }, "DATABASE_URL must not include a fragment"],
  ["database query host override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?host=other.example" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query encoded host override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?%68ost=other.example" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query user override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?USER=admin" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query password override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?password=unsafe" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query database override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?dbname=other" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query port override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?port=1234" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database query service override", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app?service=other" }, "DATABASE_URL query parameters must not override connection identity"],
  ["database URL missing username", { ...base, DATABASE_URL: "postgresql://:secret@db.internal/app" }, "DATABASE_URL must include explicit username and password"],
  ["database URL missing password", { ...base, DATABASE_URL: "postgresql://app@db.internal/app" }, "DATABASE_URL must include explicit username and password"],
  ["database URL encoded blank database", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/%20" }, "DATABASE_URL must include a nonblank database name"],
  ["database URL leading encoded space", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/%20app" }, "DATABASE_URL database name must not contain surrounding whitespace"],
  ["database URL trailing encoded space", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app%20" }, "DATABASE_URL database name must not contain surrounding whitespace"],
  ["database URL leading encoded NBSP", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/%C2%A0app" }, "DATABASE_URL database name must not contain surrounding whitespace"],
  ["database URL trailing encoded em space", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app%E2%80%83" }, "DATABASE_URL database name must not contain surrounding whitespace"],
  ["database URL encoded database newline", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app%0A" }, "DATABASE_URL database name must not contain control characters"],
  ["database URL encoded database NUL", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app%00" }, "DATABASE_URL database name must not contain control characters"],
  ["database URL malformed database escape", { ...base, DATABASE_URL: "postgresql://app:fixture@db.internal/app%ZZ" }, "DATABASE_URL database name must use valid percent-encoding"],
  ["database URL encoded blank username", { ...base, DATABASE_URL: "postgresql://%20:fixture@db.internal/app" }, "DATABASE_URL must include explicit username and password"],
  ["database URL encoded blank password", { ...base, DATABASE_URL: "postgresql://app:%20@db.internal/app" }, "DATABASE_URL must include explicit username and password"],
  ["database URL encoded leading username space", { ...base, DATABASE_URL: "postgresql://%20app:fixture@db.internal/app" }, "DATABASE_URL credentials must not contain surrounding whitespace"],
  ["database URL encoded trailing username NBSP", { ...base, DATABASE_URL: "postgresql://app%C2%A0:fixture@db.internal/app" }, "DATABASE_URL credentials must not contain surrounding whitespace"],
  ["database URL encoded leading password em space", { ...base, DATABASE_URL: "postgresql://app:%E2%80%83fixture@db.internal/app" }, "DATABASE_URL credentials must not contain surrounding whitespace"],
  ["database URL encoded trailing password space", { ...base, DATABASE_URL: "postgresql://app:fixture%20@db.internal/app" }, "DATABASE_URL credentials must not contain surrounding whitespace"],
  ["database URL placeholder username", { ...base, DATABASE_URL: "postgresql://CHANGE_ME:fixture@db.internal/app" }, "DATABASE_URL credentials must not be placeholders"],
  ["database URL placeholder password", { ...base, DATABASE_URL: "postgresql://app:replace_me@db.internal/app" }, "DATABASE_URL credentials must not be placeholders"],
  ["database URL percent-encoded placeholder password", { ...base, DATABASE_URL: "postgresql://app:%74%6F%64%6F@db.internal/app" }, "DATABASE_URL credentials must not be placeholders"],
  ["database URL mixed-case placeholder username", { ...base, DATABASE_URL: "postgresql://UnKnOwN:fixture@db.internal/app" }, "DATABASE_URL credentials must not be placeholders"],
  ["database URL malformed password escape", { ...base, DATABASE_URL: "postgresql://app:%ZZ@db.internal/app" }, "DATABASE_URL credentials must use valid percent-encoding"],
  ["database URL encoded password newline", { ...base, DATABASE_URL: "postgresql://app:%0A@db.internal/app" }, "DATABASE_URL credentials must not contain control characters"],
  ["database URL whitespace", { ...base, DATABASE_URL: " postgresql://db.internal/app" }, "DATABASE_URL must not contain surrounding whitespace"],
  ["database URL embedded tab", { ...base, DATABASE_URL: "postgresql://db.internal/\tapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL embedded newline", { ...base, DATABASE_URL: "postgresql://db.internal/\napp" }, "DATABASE_URL must not contain control characters"],
  ["database URL embedded carriage return", { ...base, DATABASE_URL: "postgresql://db.internal/\rapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL DEL control", { ...base, DATABASE_URL: "postgresql://db.internal/\u007fapp" }, "DATABASE_URL must not contain control characters"],
  ["database URL NUL control", { ...base, DATABASE_URL: "postgresql://db.internal/\u0000app" }, "DATABASE_URL must not contain control characters"],
  ["database URL backslash in path", { ...base, DATABASE_URL: "postgresql://db.internal/app\\\\other" }, "DATABASE_URL must not contain backslashes"],
  ["database URL backslash in authority", { ...base, DATABASE_URL: "postgresql://db.internal\\\\@evil.example/app" }, "DATABASE_URL must not contain backslashes"],
  ["missing primary", (() => {
    const copy = { ...base };
    delete copy.AI_PRIMARY_BASE_URL;
    delete copy.AI_PRIMARY_API_KEY;
    delete copy.AI_PRIMARY_MODEL;
    return copy;
  })(), "AI_PRIMARY provider is required in production"],
  ["partial secondary", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1" }, "AI_SECONDARY provider configuration is incomplete"],
  ["insecure provider", { ...base, AI_PRIMARY_BASE_URL: "http://api.example.com/v1" }, "AI_PRIMARY_BASE_URL must use HTTPS"],
  ["OIDC issuer empty userinfo", { ...base, OIDC_ISSUER: "https://@identity.example.com/tenant" }, "OIDC_ISSUER must not contain credentials"],
  ["OIDC JWKS empty userinfo", { ...base, OIDC_JWKS_URL: "https://:@identity.example.com/keys" }, "OIDC_JWKS_URL must not contain credentials"],
  ["AI primary empty userinfo", { ...base, AI_PRIMARY_BASE_URL: "https://@api.example.com/v1" }, "AI_PRIMARY_BASE_URL must not contain credentials"],
  ["AI primary normalized slash prefix", { ...base, AI_PRIMARY_BASE_URL: "https:////api.example.com/v1" }, "AI_PRIMARY_BASE_URL must include an explicit HTTPS authority"],
  ["AI secondary empty userinfo", { ...base, AI_SECONDARY_BASE_URL: "https://:@backup.example.com/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not contain credentials"],
  ["provider leading whitespace", { ...base, AI_PRIMARY_BASE_URL: " https://api.example.com/v1" }, "AI_PRIMARY_BASE_URL must not contain surrounding whitespace"],
  ["provider embedded tab", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\tv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider embedded newline", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\nv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider embedded carriage return", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\rv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["provider DEL control", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/\u007fv1" }, "AI_PRIMARY_BASE_URL must not contain control characters"],
  ["secondary provider control", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/\tv1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not contain control characters"],
  ["provider key trailing whitespace", { ...base, AI_PRIMARY_API_KEY: "fixture-key " }, "AI_PRIMARY_API_KEY must not contain surrounding whitespace"],
  ["provider blank model", { ...base, AI_PRIMARY_MODEL: "   " }, "AI_PRIMARY_MODEL must not be blank"],
  ["provider API key embedded tab", { ...base, AI_PRIMARY_API_KEY: "fixture\tkey" }, "AI_PRIMARY_API_KEY must not contain control characters"],
  ["provider model embedded newline", { ...base, AI_PRIMARY_MODEL: "reasoning\nmodel" }, "AI_PRIMARY_MODEL must not contain control characters"],
  ["secondary provider API key NUL", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1", AI_SECONDARY_API_KEY: "backup\u0000key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_API_KEY must not contain control characters"],
  ["tertiary provider model DEL", { ...base, AI_TERTIARY_BASE_URL: "https://backup.example.com/v1", AI_TERTIARY_API_KEY: "backup-key", AI_TERTIARY_MODEL: "backup\u007fmodel" }, "AI_TERTIARY_MODEL must not contain control characters"],
  ["database empty fragment", { ...base, DATABASE_URL: "postgresql://db.internal/app#" }, "DATABASE_URL must not include a fragment"],
  ["OIDC issuer empty query", { ...base, OIDC_ISSUER: "https://identity.example.com/tenant?" }, "OIDC_ISSUER must not include query parameters"],
  ["OIDC issuer query", { ...base, OIDC_ISSUER: "https://identity.example.com/tenant?debug=true" }, "OIDC_ISSUER must not include query parameters"],
  ["OIDC issuer localhost", { ...base, OIDC_ISSUER: "https://localhost/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer port zero", { ...base, OIDC_ISSUER: "https://identity.example.com:0/tenant" }, "OIDC_ISSUER must not use port 0"],
  ["OIDC issuer loopback IPv4", { ...base, OIDC_ISSUER: "https://127.0.0.1/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer cloud metadata IPv4", { ...base, OIDC_ISSUER: "https://169.254.169.254/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer private IPv4", { ...base, OIDC_ISSUER: "https://10.0.0.1/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer loopback IPv6", { ...base, OIDC_ISSUER: "https://[::1]/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer local domain", { ...base, OIDC_ISSUER: "https://identity.internal.local/tenant" }, "OIDC_ISSUER must not use a local hostname"],
  ["OIDC issuer empty fragment", { ...base, OIDC_ISSUER: "https://identity.example.com/tenant#" }, "OIDC_ISSUER must not include a fragment"],
  ["OIDC JWKS empty fragment", { ...base, OIDC_JWKS_URL: "https://identity.example.com/.well-known/jwks.json#" }, "OIDC_JWKS_URL must not include a fragment"],
  ["provider empty query", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/v1?" }, "AI_PRIMARY_BASE_URL must not include query parameters"],
  ["provider empty fragment", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/v1#" }, "AI_PRIMARY_BASE_URL must not include a fragment"],
  ["secondary provider empty fragment", { ...base, AI_SECONDARY_BASE_URL: "https://backup.example.com/v1#", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not include a fragment"],
  ["provider query", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com/v1?token=unsafe" }, "AI_PRIMARY_BASE_URL must not include query parameters"],
  ["JWKS localhost", { ...base, OIDC_JWKS_URL: "https://localhost/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["JWKS port zero", { ...base, OIDC_JWKS_URL: "https://identity.example.com:0/keys" }, "OIDC_JWKS_URL must not use port 0"],
  ["JWKS loopback IPv4", { ...base, OIDC_JWKS_URL: "https://127.0.0.1/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["JWKS cloud metadata IPv4", { ...base, OIDC_JWKS_URL: "https://169.254.169.254/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["JWKS private IPv4", { ...base, OIDC_JWKS_URL: "https://10.0.0.1/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["JWKS loopback IPv6", { ...base, OIDC_JWKS_URL: "https://[::1]/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["JWKS local domain", { ...base, OIDC_JWKS_URL: "https://identity.internal.local/keys" }, "OIDC_JWKS_URL must not use a local hostname"],
  ["primary localhost", { ...base, AI_PRIMARY_BASE_URL: "https://localhost/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["primary provider port zero", { ...base, AI_PRIMARY_BASE_URL: "https://api.example.com:0/v1" }, "AI_PRIMARY_BASE_URL must not use port 0"],
  ["primary localhost subdomain", { ...base, AI_PRIMARY_BASE_URL: "https://ai.localhost/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["primary loopback IPv4", { ...base, AI_PRIMARY_BASE_URL: "https://127.0.0.1/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["secondary loopback IPv4", { ...base, AI_SECONDARY_BASE_URL: "https://127.0.0.2/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not use a local hostname"],
  ["tertiary loopback IPv6", { ...base, AI_TERTIARY_BASE_URL: "https://[::1]/v1", AI_TERTIARY_API_KEY: "backup-key", AI_TERTIARY_MODEL: "backup-model" }, "AI_TERTIARY_BASE_URL must not use a local hostname"],
  ["primary private IPv4", { ...base, AI_PRIMARY_BASE_URL: "https://10.0.0.1/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["primary cloud metadata IPv4", { ...base, AI_PRIMARY_BASE_URL: "https://169.254.169.254/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["secondary private IPv4", { ...base, AI_SECONDARY_BASE_URL: "https://192.168.1.10/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not use a local hostname"],
  ["tertiary carrier-grade NAT IPv4", { ...base, AI_TERTIARY_BASE_URL: "https://100.64.0.1/v1", AI_TERTIARY_API_KEY: "backup-key", AI_TERTIARY_MODEL: "backup-model" }, "AI_TERTIARY_BASE_URL must not use a local hostname"],
  ["primary documentation IPv4", { ...base, AI_PRIMARY_BASE_URL: "https://203.0.113.7/v1" }, "AI_PRIMARY_BASE_URL must not use a local hostname"],
  ["secondary local domain", { ...base, AI_SECONDARY_BASE_URL: "https://model.internal.local/v1", AI_SECONDARY_API_KEY: "backup-key", AI_SECONDARY_MODEL: "backup-model" }, "AI_SECONDARY_BASE_URL must not use a local hostname"],
]) {
  assert.throws(
    () => validateProductionPreflight(env),
    (error) => error instanceof Error && error.message.includes(expected),
    `${name} must fail with ${expected}`,
  );
}

console.log("Production preflight regression checks passed.");
