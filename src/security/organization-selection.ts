import { db } from "@/infrastructure/database/postgres";

export async function resolveOrganizationForActor(actorId: string, requestedOrganizationId?: string): Promise<string> {
  if (requestedOrganizationId) {
    const allowed = await db.query(
      `SELECT 1 FROM organization_memberships WHERE actor_id=$1 AND organization_id=$2`,
      [actorId, requestedOrganizationId],
    );
    if (!allowed.rowCount) throw new Error("Organization access denied");
    return requestedOrganizationId;
  }

  const memberships = await db.query(
    `SELECT organization_id FROM organization_memberships WHERE actor_id=$1 ORDER BY created_at ASC LIMIT 2`,
    [actorId],
  );
  if (!memberships.rowCount) throw new Error("No organization membership found");
  if (memberships.rowCount > 1) throw new Error("Organization selection required");
  return String(memberships.rows[0].organization_id);
}
