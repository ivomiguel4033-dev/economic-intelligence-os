import assert from "node:assert/strict";
import { assertPermission, assertTenantBoundary } from "../src/security/tenant-boundary.ts";

const tenantA = { actorId: "actor-a", organizationId: "org-a", permissions: ["decision:read"] };

assert.doesNotThrow(() => assertTenantBoundary(tenantA, "org-a"));
assert.throws(() => assertTenantBoundary(tenantA, "org-b"), /Cross-tenant access denied/);
assert.throws(() => assertTenantBoundary({ ...tenantA, organizationId: "" }, ""), /Cross-tenant access denied/);
assert.throws(() => assertTenantBoundary({ ...tenantA, organizationId: " org-a" }, " org-a"), /Cross-tenant access denied/);
assert.throws(() => assertTenantBoundary({ ...tenantA, organizationId: "org-a " }, "org-a "), /Cross-tenant access denied/);
assert.throws(() => assertTenantBoundary(tenantA, " org-a"), /Cross-tenant access denied/);
assert.throws(() => assertTenantBoundary(tenantA, "org-a "), /Cross-tenant access denied/);

assert.doesNotThrow(() => assertPermission(tenantA, "decision:read"));
assert.throws(() => assertPermission(tenantA, "decision:execute"), /Permission denied/);
assert.throws(() => assertPermission(tenantA, ""), /Permission denied/);
assert.throws(() => assertPermission(tenantA, " decision:read"), /Permission denied/);
assert.throws(() => assertPermission(tenantA, "decision:read "), /Permission denied/);
assert.doesNotThrow(() => assertPermission({ ...tenantA, permissions: ["*"] }, "decision:execute"));

console.log("Security regression checks passed against production tenant-boundary implementation.");
