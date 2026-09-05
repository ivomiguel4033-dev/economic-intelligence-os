export interface TenantPrincipal {
  actorId: string;
  organizationId: string;
  permissions: string[];
}

function isValidTenantId(value: string): boolean {
  return value.length > 0 && value.trim() === value && value.trim().length > 0;
}

export function assertTenantBoundary(principal: TenantPrincipal, resourceOrganizationId: string): void {
  if (
    !isValidTenantId(principal.organizationId) ||
    !isValidTenantId(resourceOrganizationId) ||
    principal.organizationId !== resourceOrganizationId
  ) {
    throw new Error("Cross-tenant access denied");
  }
}

export function assertPermission(principal: TenantPrincipal, permission: string): void {
  if (!permission || permission.trim() !== permission || !principal.permissions.includes(permission) && !principal.permissions.includes("*")) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
