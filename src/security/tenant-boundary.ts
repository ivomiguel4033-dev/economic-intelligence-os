export interface TenantPrincipal {
  actorId: string;
  organizationId: string;
  permissions: string[];
}

function isValidTenantId(value: string): boolean {
  return value.length > 0 && value.trim() === value && value.trim().length > 0;
}

function isValidPermission(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function hasValidPermissionSet(permissions: string[]): boolean {
  return permissions.every(isValidPermission);
}

function hasValidPrincipalIdentity(principal: TenantPrincipal): boolean {
  return isValidTenantId(principal.actorId) && isValidTenantId(principal.organizationId);
}

export function assertTenantBoundary(principal: TenantPrincipal, resourceOrganizationId: string): void {
  if (
    !hasValidPrincipalIdentity(principal) ||
    !isValidTenantId(resourceOrganizationId) ||
    principal.organizationId !== resourceOrganizationId
  ) {
    throw new Error("Cross-tenant access denied");
  }
}

export function assertPermission(principal: TenantPrincipal, permission: string): void {
  if (
    !hasValidPrincipalIdentity(principal) ||
    !isValidPermission(permission) ||
    !hasValidPermissionSet(principal.permissions) ||
    (!principal.permissions.includes(permission) && !principal.permissions.includes("*"))
  ) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
