import assert from "node:assert/strict";

function assertTenantBoundary(principal, resourceOrganizationId) {
  if (!principal.organizationId || principal.organizationId !== resourceOrganizationId) throw new Error("Cross-tenant access denied");
}
function assertPermission(principal, permission) {
  if (!principal.permissions.includes(permission) && !principal.permissions.includes("*")) throw new Error(`Permission denied: ${permission}`);
}

const tenantA = { actorId: "actor-a", organizationId: "org-a", permissions: ["decision:read"] };
assert.doesNotThrow(() => assertTenantBoundary(tenantA, "org-a"));
assert.throws(() => assertTenantBoundary(tenantA, "org-b"), /Cross-tenant access denied/);
assert.doesNotThrow(() => assertPermission(tenantA, "decision:read"));
assert.throws(() => assertPermission(tenantA, "decision:execute"), /Permission denied/);
assert.doesNotThrow(() => assertPermission({ ...tenantA, permissions: ["*"] }, "decision:execute"));
console.log("Security regression checks passed: tenant boundary and permission enforcement.");
