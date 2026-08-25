export interface TenantPrincipal {
  actorId: string;
  organizationId: string;
  permissions: string[];
}

export function assertTenantBoundary(principal: TenantPrincipal, resourceOrganizationId: string): void {
  if (!principal.organizationId || principal.organizationId !== resourceOrganizationId) {
    throw new Error("Cross-tenant access denied");
  }
}

export function assertPermission(principal: TenantPrincipal, permission: string): void {
  if (!principal.permissions.includes(permission) && !principal.permissions.includes("*")) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
