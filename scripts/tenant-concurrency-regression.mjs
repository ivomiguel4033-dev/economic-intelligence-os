import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const guard = await readFile(new URL("../src/operations/tenant-concurrency.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/orchestrate/route.ts", import.meta.url), "utf8");

assert.match(guard, /new Map<string, TenantConcurrencyState>\(\)/, "tenant concurrency state must be keyed by tenant");
assert.match(guard, /tenantConcurrency\.get\(organizationId\)/, "acquisition must read only the current tenant state");
assert.match(guard, /tenantConcurrency\.set\(organizationId, \{ active: current \+ 1 \}\)/, "acquisition must increment only the current tenant");
assert.match(guard, /if \(current >= configuredLimit\(\)\) return null;/, "tenant limit must fail closed before incrementing");
assert.match(guard, /let released = false;/, "release must track idempotency");
assert.match(guard, /if \(released\) return;/, "duplicate release must be a no-op");
assert.match(guard, /tenantConcurrency\.delete\(organizationId\)/, "last release must remove tenant state");

const authIndex = route.indexOf("await resolveAuthenticatedContext(");
const authorizationIndex = route.indexOf("requireAuthorization(");
const acquireIndex = route.indexOf("tryAcquireTenantConcurrency(organizationId)");
const decisionLookupIndex = route.indexOf("await decisions.findById(decisionId)");
const billingIndex = route.indexOf("await enforceRuntimeBilling(");
const releaseIndex = route.indexOf("releaseTenantConcurrency?.()");

assert.ok(authIndex >= 0 && authorizationIndex > authIndex, "tenant identity must be authenticated and authorized first");
assert.ok(acquireIndex > authorizationIndex, "tenant concurrency must use an authorized tenant identity");
assert.ok(decisionLookupIndex > acquireIndex, "tenant concurrency must be acquired before decision database work");
assert.ok(billingIndex > acquireIndex, "tenant concurrency must be acquired before billing work");
assert.ok(releaseIndex > acquireIndex, "tenant concurrency must always have a release path");

const limitedBlock = route.slice(acquireIndex, decisionLookupIndex);
assert.match(limitedBlock, /reason:\s*"tenant_concurrency_limited"/, "limit responses must expose a stable machine-readable reason");
assert.match(limitedBlock, /status:\s*429/, "tenant concurrency exhaustion must return HTTP 429");
assert.match(limitedBlock, /"Retry-After":\s*"1"/, "limited tenants must receive retry guidance");
assert.match(limitedBlock, /"Cache-Control":\s*"no-store"/, "tenant limit responses must not be cached");
assert.match(route, /finally\s*\{[\s\S]*?releaseTenantConcurrency\?\.\(\);[\s\S]*?releaseWork\(\);\s*\}/, "tenant slot and tracked work must be released in finally");

console.log("tenant concurrency regression checks passed");
