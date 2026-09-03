import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const guard = await readFile(
  new URL("../src/operations/distributed-tenant-concurrency.ts", import.meta.url),
  "utf8",
);
const route = await readFile(new URL("../src/app/api/orchestrate/route.ts", import.meta.url), "utf8");

assert.match(
  guard,
  /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)/,
  "tenant concurrency acquisition must serialize per tenant across replicas",
);
assert.match(
  guard,
  /WHERE organization_id=\$1(?:::uuid)? AND expires_at > NOW\(\)/,
  "tenant concurrency capacity must count only active leases for the current tenant",
);
assert.match(
  guard,
  /if \(\(capacity\.rows\[0\]\?\.active \?\? limit\) >= limit\)/,
  "tenant concurrency must fail closed at the configured limit",
);
assert.match(guard, /let releasePromise: Promise<void> \| undefined;/, "release must track in-flight idempotency");
assert.match(guard, /if \(releasePromise\) return releasePromise;/, "concurrent duplicate release must share the same operation");
assert.match(guard, /releasePromise = undefined;/, "failed release must remain retryable");
assert.match(
  guard,
  /WHERE organization_id=\$1(?:::uuid)? AND lease_token=\$2(?:::uuid)?/,
  "release must remain tenant and lease-token scoped",
);

const authIndex = route.indexOf("await resolveAuthenticatedContext(");
const authorizationIndex = route.indexOf("requireAuthorization(");
const acquireIndex = route.indexOf("await tryAcquireDistributedTenantConcurrency(organizationId)");
const decisionLookupIndex = route.indexOf("await decisions.findById(decisionId)");
const billingIndex = route.indexOf("await enforceRuntimeBilling(");
const releaseIndex = route.indexOf("await tenantConcurrencyLease?.release()");

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

const cleanupIndex = route.lastIndexOf("} finally {");
assert.ok(cleanupIndex > releaseIndex - 200, "distributed lease cleanup must execute from the route finally block");
const cleanupBlock = route.slice(cleanupIndex);
assert.match(
  cleanupBlock,
  /try\s*\{[\s\S]*?await tenantConcurrencyLease\?\.release\(\);[\s\S]*?catch \(error\)[\s\S]*?Failed to release distributed tenant concurrency lease[\s\S]*?finally\s*\{[\s\S]*?releaseWork\(\);\s*\}/,
  "lease release failures must be contained without skipping tracked-work cleanup",
);
assert.match(
  cleanupBlock,
  /catch \(error\)\s*\{[\s\S]*?console\.error\([\s\S]*?\}\s*finally\s*\{[\s\S]*?releaseWork\(\);/,
  "lease cleanup failure handling must not return or throw before tracked-work cleanup",
);

console.log("tenant concurrency regression checks passed");
