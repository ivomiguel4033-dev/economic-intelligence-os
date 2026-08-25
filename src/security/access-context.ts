import { db } from "@/infrastructure/database/postgres";

export interface AccessContext {
  actorId: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
}

export async function resolveAccessContext(actorId: string, organizationId: string): Promise<AccessContext> {
  const membership = await db.query(
    `SELECT m.role, r.permissions
     FROM organization_memberships m
     LEFT JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role=m.role
     JOIN actors a ON a.id=m.actor_id
     WHERE m.actor_id=$1 AND m.organization_id=$2 AND a.disabled_at IS NULL`,
    [actorId, organizationId],
  );
  if (!membership.rowCount) throw new Error("Organization membership required");
  const roles = membership.rows.map((row) => String(row.role));
  const permissions = [...new Set(membership.rows.flatMap((row) => Array.isArray(row.permissions) ? row.permissions.map(String) : []))];
  return { actorId, organizationId, roles, permissions };
}
