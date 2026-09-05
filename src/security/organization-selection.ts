import { db } from "@/infrastructure/database/postgres";

function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export async function resolveOrganizationForActor(actorId: string, requestedOrganizationId?: string): Promise<string> {
  if (!isCanonicalIdentifier(actorId)) throw new Error("Invalid actor identity");

  if (requestedOrganizationId !== undefined) {
    if (!isCanonicalIdentifier(requestedOrganizationId)) throw new Error("Invalid organization selection");

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

  const organizationId = memberships.rows[0]?.organization_id;
  if (!isCanonicalIdentifier(organizationId)) throw new Error("Invalid organization membership");
  return organizationId;
}
