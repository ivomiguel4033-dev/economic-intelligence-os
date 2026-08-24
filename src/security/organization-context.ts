export interface OrganizationContext {
  organizationId: string;
  actorId: string;
  roles: string[];
}

export function requireOrganizationContext(headers: Headers): OrganizationContext {
  const organizationId = headers.get("x-organization-id")?.trim();
  const actorId = headers.get("x-actor-id")?.trim();

  if (!organizationId || !actorId) {
    throw new Error("Authenticated organization context required");
  }

  const roles = (headers.get("x-roles") ?? "member")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  return { organizationId, actorId, roles };
}

export function assertOrganizationAccess(resourceOrganizationId: string, context: OrganizationContext) {
  if (resourceOrganizationId !== context.organizationId) {
    throw new Error("Cross-organization access denied");
  }
}
