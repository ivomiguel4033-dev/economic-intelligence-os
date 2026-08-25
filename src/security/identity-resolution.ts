import { db } from "@/infrastructure/database/postgres";
import type { VerifiedIdentity } from "@/security/identity";
import { assertIdentityFresh } from "@/security/identity";

export interface ResolvedIdentity {
  actorId: string;
  provider: string;
  subject: string;
  email?: string;
}

export async function resolveVerifiedIdentity(identity: VerifiedIdentity): Promise<ResolvedIdentity> {
  assertIdentityFresh(identity);
  if (identity.email && !identity.emailVerified) throw new Error("Verified email required");
  const result = await db.query(
    `SELECT a.id AS actor_id, ai.provider, ai.subject, COALESCE(a.email, ai.email) AS email
     FROM actor_identities ai
     JOIN actors a ON a.id=ai.actor_id
     WHERE ai.provider=$1 AND ai.subject=$2 AND a.disabled_at IS NULL`,
    [identity.provider, identity.subject],
  );
  if (!result.rows[0]) throw new Error("Identity is not linked to an active actor");
  return {
    actorId: String(result.rows[0].actor_id),
    provider: String(result.rows[0].provider),
    subject: String(result.rows[0].subject),
    email: result.rows[0].email ? String(result.rows[0].email) : identity.email,
  };
}
