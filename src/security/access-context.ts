import { db } from "../infrastructure/database/postgres.ts";

export interface AccessContext {
  actorId: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
}

function isCanonicalIdentifier(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function isCanonicalStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && isCanonicalIdentifier(entry));
}

export async function resolveAccessContext(actorId: string, organizationId: string): Promise<AccessContext> {
  if (!isCanonicalIdentifier(actorId) || !isCanonicalIdentifier(organizationId)) {
    throw new Error("Invalid access context identity");
  }

  const membership = await db.query(
    `SELECT m.role, r.permissions
     FROM organization_memberships m
     LEFT JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role=m.role
     JOIN actors a ON a.id=m.actor_id
     WHERE m.actor_id=$1 AND m.organization_id=$2 AND a.disabled_at IS NULL`,
    [actorId, organizationId],
  );
  if (!membership.rowCount) throw new Error("Organization membership required");

  const roles: string[] = [];
  const permissions: string[] = [];
  for (const row of membership.rows) {
    if (typeof row.role !== "string" || !isCanonicalIdentifier(row.role)) {
      throw new Error("Invalid organization role configuration");
    }
    if (row.permissions !== null && row.permissions !== undefined && !isCanonicalStringArray(row.permissions)) {
      throw new Error("Invalid organization permission configuration");
    }
    roles.push(row.role);
    if (row.permissions) permissions.push(...row.permissions);
  }

  return {
    actorId,
    organizationId,
    roles: [...new Set(roles)],
    permissions: [...new Set(permissions)],
  };
}
