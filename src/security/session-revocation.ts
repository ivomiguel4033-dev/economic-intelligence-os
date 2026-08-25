import { db } from "@/infrastructure/database/postgres";

export async function revokeSession(sessionId: string, actorId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE security_sessions
     SET revoked_at=COALESCE(revoked_at, NOW()), revocation_reason=COALESCE(revocation_reason, $3)
     WHERE id=$1 AND actor_id=$2`,
    [sessionId, actorId, reason],
  );
}

export async function revokeAllActorSessions(actorId: string, reason: string, exceptSessionId?: string): Promise<number> {
  const result = await db.query(
    `UPDATE security_sessions
     SET revoked_at=COALESCE(revoked_at, NOW()), revocation_reason=COALESCE(revocation_reason, $2)
     WHERE actor_id=$1 AND revoked_at IS NULL
       AND ($3::text IS NULL OR id::text <> $3::text)`,
    [actorId, reason, exceptSessionId ?? null],
  );
  return result.rowCount ?? 0;
}

export async function assertSessionNotRevoked(sessionId: string, actorId: string): Promise<void> {
  const result = await db.query(
    `SELECT expires_at, revoked_at FROM security_sessions WHERE id=$1 AND actor_id=$2 LIMIT 1`,
    [sessionId, actorId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Security session not found");
  if (row.revoked_at) throw new Error("Security session revoked");
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Security session expired");
}
