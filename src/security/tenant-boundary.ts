export interface TenantPrincipal {
  actorId: string;
  organizationId: string;
  permissions: string[];
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

function isCanonicalAuthorizationValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function isValidTenantId(value: unknown): value is string {
  return isCanonicalAuthorizationValue(value);
}

function isValidPermission(value: unknown): value is string {
  return isCanonicalAuthorizationValue(value);
}

function hasValidPermissionSet(permissions: unknown): permissions is string[] {
  return Array.isArray(permissions) && permissions.every(isValidPermission);
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
