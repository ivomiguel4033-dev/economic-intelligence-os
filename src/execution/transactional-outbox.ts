import { db } from "@/infrastructure/database/postgres";

export type OutboxMessage = {
  id: string;
  organizationId: string;
  executionRunId?: string;
  eventType: string;
  dedupeKey: string;
  payload: unknown;
  attempts: number;
  claimToken: string;
};

export type OutboxOperationalSnapshot = {
  ready: number;
  processing: number;
  failed: number;
  deadLettered: number;
  oldestReadyAgeSeconds: number;
};

export class OutboxClaimOwnershipError extends Error {
  constructor(operation: "delivery" | "failure") {
    super(`Outbox ${operation} acknowledgement rejected`);
    this.name = "OutboxClaimOwnershipError";
  }
}

export class OutboxIdempotencyConflictError extends Error {
  constructor() {
    super("Outbox dedupe key already exists with different event contents");
    this.name = "OutboxIdempotencyConflictError";
  }
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value), max));
}

export async function getOutboxOperationalSnapshot(): Promise<OutboxOperationalSnapshot> {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('pending','failed') AND available_at <= NOW())::int AS ready,
       COUNT(*) FILTER (WHERE status='processing')::int AS processing,
       COUNT(*) FILTER (WHERE status='failed')::int AS failed,
       COUNT(*) FILTER (WHERE status='dead_lettered')::int AS dead_lettered,
       COALESCE(
         EXTRACT(EPOCH FROM (NOW() - MIN(available_at) FILTER (
           WHERE status IN ('pending','failed') AND available_at <= NOW()
         ))),
         0
       )::bigint AS oldest_ready_age_seconds
     FROM execution_outbox`,
  );
  const row = result.rows[0] ?? {};
  return {
    ready: Number(row.ready ?? 0),
    processing: Number(row.processing ?? 0),
    failed: Number(row.failed ?? 0),
    deadLettered: Number(row.dead_lettered ?? 0),
    oldestReadyAgeSeconds: Number(row.oldest_ready_age_seconds ?? 0),
  };
}

/** Counts only durable claims owned by this process/worker. */
export async function getClaimedOutboxCount(workerId: string): Promise<number> {
  if (!workerId) throw new Error("Outbox workerId is required");
  const result = await db.query(
    `SELECT COUNT(*)::int AS claimed
     FROM execution_outbox
     WHERE status='processing' AND claimed_by=$1`,
    [workerId],
  );
  const claimed = Number(result.rows[0]?.claimed ?? 0);
  if (!Number.isSafeInteger(claimed) || claimed < 0) {
    throw new Error("Invalid claimed outbox count");
  }
  return claimed;
}

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
     ON CONFLICT (organization_id, dedupe_key) DO UPDATE
       SET dedupe_key=EXCLUDED.dedupe_key
       WHERE execution_outbox.execution_run_id IS NOT DISTINCT FROM EXCLUDED.execution_run_id
         AND execution_outbox.event_type=EXCLUDED.event_type
         AND execution_outbox.payload=EXCLUDED.payload
     RETURNING id`,
    [input.organizationId, input.executionRunId ?? null, input.eventType, input.dedupeKey, JSON.stringify(input.payload)],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new OutboxIdempotencyConflictError();
  return String(id);
}

export async function reclaimStaleOutbox(
  maxProcessingSeconds = 300,
  retryAfterSeconds = 5,
  maxAttempts = 5,
): Promise<{ reclaimed: number; deadLettered: number }> {
  const staleAfter = boundedInteger(maxProcessingSeconds, 300, 30, 86400);
  const retryDelay = boundedInteger(retryAfterSeconds, 5, 1, 3600);
  const attemptLimit = boundedInteger(maxAttempts, 5, 1, 100);
  const result = await db.query(
    `UPDATE execution_outbox
     SET status=CASE WHEN attempts >= $3 THEN 'dead_lettered' ELSE 'failed' END,
         available_at=CASE WHEN attempts >= $3 THEN available_at ELSE NOW() + ($2 * INTERVAL '1 second') END,
         claimed_at=NULL,
         claimed_by=NULL,
         last_error='stale processing claim reclaimed',
         dead_lettered_at=CASE WHEN attempts >= $3 THEN NOW() ELSE NULL END,
         updated_at=NOW()
     WHERE status='processing'
       AND claimed_at IS NOT NULL
       AND claimed_at <= NOW() - ($1 * INTERVAL '1 second')
     RETURNING status`,
    [staleAfter, retryDelay, attemptLimit],
  );
  const deadLettered = result.rows.filter((row) => row.status === "dead_lettered").length;
  return { reclaimed: (result.rowCount ?? 0) - deadLettered, deadLettered };
}

export async function claimOutbox(workerId: string, limit = 25): Promise<OutboxMessage[]> {
  if (!workerId) throw new Error("Outbox workerId is required");
  const batch = boundedInteger(limit, 25, 1, 100);
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
         attempts=o.attempts + 1, claim_token=o.claim_token + 1,
         last_error=NULL, dead_lettered_at=NULL, updated_at=NOW()
     FROM candidates c
     WHERE o.id=c.id
     RETURNING o.id, o.organization_id, o.execution_run_id, o.event_type,
               o.dedupe_key, o.payload, o.attempts, o.claim_token::text AS claim_token`,
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
    claimToken: String(row.claim_token),
  }));
}

/** Renews only the exact fenced claim that is still owned by the worker. */
export async function renewOutboxClaim(input: { id: string; organizationId: string; workerId: string; claimToken: string }): Promise<boolean> {
  const result = await db.query(
    `UPDATE execution_outbox
     SET claimed_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint`,
    [input.id, input.organizationId, input.workerId, input.claimToken],
  );
  return result.rowCount === 1;
}

export async function markOutboxDelivered(input: { id: string; organizationId: string; workerId: string; claimToken: string }): Promise<void> {
  const result = await db.query(
    `UPDATE execution_outbox
     SET status='delivered', delivered_at=NOW(), claimed_at=NULL, claimed_by=NULL, updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint`,
    [input.id, input.organizationId, input.workerId, input.claimToken],
  );
  if (result.rowCount !== 1) throw new OutboxClaimOwnershipError("delivery");
}

export async function markOutboxFailed(input: {
  id: string;
  organizationId: string;
  workerId: string;
  claimToken: string;
  error: string;
  retryAfterSeconds?: number;
  maxAttempts?: number;
}): Promise<"failed" | "dead_lettered"> {
  const delay = boundedInteger(input.retryAfterSeconds, 30, 1, 3600);
  const attemptLimit = boundedInteger(input.maxAttempts, 5, 1, 100);
  const result = await db.query(
    `UPDATE execution_outbox
     SET status=CASE WHEN attempts >= $7 THEN 'dead_lettered' ELSE 'failed' END,
         available_at=CASE WHEN attempts >= $7 THEN available_at ELSE NOW() + ($6 * INTERVAL '1 second') END,
         claimed_at=NULL,
         claimed_by=NULL,
         last_error=$5,
         dead_lettered_at=CASE WHEN attempts >= $7 THEN NOW() ELSE NULL END,
         updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND status='processing' AND claimed_by=$3 AND claim_token=$4::bigint
     RETURNING status`,
    [input.id, input.organizationId, input.workerId, input.claimToken, input.error.slice(0, 1000), delay, attemptLimit],
  );
  if (result.rowCount !== 1) throw new OutboxClaimOwnershipError("failure");
  return result.rows[0].status === "dead_lettered" ? "dead_lettered" : "failed";
}
