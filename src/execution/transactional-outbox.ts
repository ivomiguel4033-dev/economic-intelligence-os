import { db } from "@/infrastructure/database/postgres";

export type OutboxMessage = {
  id: string;
  organizationId: string;
  executionRunId?: string;
  eventType: string;
  dedupeKey: string;
  payload: unknown;
  attempts: number;
};

export async function enqueueOutbox(input: {
  organizationId: string;
  executionRunId?: string;
  eventType: string;
  dedupeKey: string;
  payload: unknown;
}): Promise<string> {
  const result = await db.query(
    `INSERT INTO execution_outbox (organization_id, execution_run_id, event_type, dedupe_key, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (organization_id, dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key
     RETURNING id`,
    [input.organizationId, input.executionRunId ?? null, input.eventType, input.dedupeKey, JSON.stringify(input.payload)],
  );
  return String(result.rows[0].id);
}

export async function claimOutbox(workerId: string, limit = 25): Promise<OutboxMessage[]> {
  if (!workerId) throw new Error("Outbox workerId is required");
  const batch = Math.max(1, Math.min(limit, 100));
  const result = await db.query(
    `WITH candidates AS (
       SELECT id
       FROM execution_outbox
       WHERE status IN ('pending','failed') AND available_at <= NOW()
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE execution_outbox o
     SET status='processing', claimed_at=NOW(), claimed_by=$1,
         attempts=o.attempts + 1, last_error=NULL, updated_at=NOW()
     FROM candidates c
     WHERE o.id=c.id
     RETURNING o.id, o.organization_id, o.execution_run_id, o.event_type,
               o.dedupe_key, o.payload, o.attempts`,
    [workerId, batch],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    executionRunId: row.execution_run_id ? String(row.execution_run_id) : undefined,
    eventType: String(row.event_type),
    dedupeKey: String(row.dedupe_key),
    payload: row.payload,
    attempts: Number(row.attempts),
  }));
}

export async function markOutboxDelivered(input: { id: string; organizationId: string; workerId: string }): Promise<void> {
  const result = await db.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL, updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3`,
    [input.id, input.organizationId, input.workerId],
  );
  if (result.rowCount !== 1) throw new Error("Outbox delivery acknowledgement rejected");
}

export async function markOutboxFailed(input: {
  id: string;
  organizationId: string;
  workerId: string;
  error: string;
  retryAfterSeconds?: number;
}): Promise<void> {
  const delay = Math.max(1, Math.min(input.retryAfterSeconds ?? 30, 3600));
  const result = await db.query(
    `UPDATE execution_outbox
     SET status='failed', available_at=NOW() + ($5 * INTERVAL '1 second'),
         claimed_at=NULL, claimed_by=NULL, last_error=$4, updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3`,
    [input.id, input.organizationId, input.workerId, input.error.slice(0, 1000), delay],
  );
  if (result.rowCount !== 1) throw new Error("Outbox failure acknowledgement rejected");
}
