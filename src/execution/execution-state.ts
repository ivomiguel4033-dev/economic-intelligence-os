import { db } from "@/infrastructure/database/postgres";

export type ExecutionState = "pending" | "running" | "succeeded" | "failed" | "uncertain" | "dead_lettered";
export type ExecutionLeaseGuard = { leaseKey: string; ownerId: string; fencingToken: string };

export async function createExecutionRun(input: { organizationId: string; actionId: string; actionType: string; idempotencyKey: string }): Promise<string> {
  const result = await db.query(
    `INSERT INTO execution_runs (organization_id, action_id, action_type, idempotency_key)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, idempotency_key) DO UPDATE SET updated_at=execution_runs.updated_at
     RETURNING id`,
    [input.organizationId, input.actionId, input.actionType, input.idempotencyKey],
  );
  return String(result.rows[0].id);
}

export async function transitionExecution(
  organizationId: string,
  runId: string,
  expectedState: ExecutionState,
  state: ExecutionState,
  input?: { result?: unknown; uncertaintyReason?: string; leaseGuard?: ExecutionLeaseGuard },
): Promise<void> {
  const guard = input?.leaseGuard;
  const result = await db.query(
    `UPDATE execution_runs
     SET state=$4, result=COALESCE($5::jsonb,result), uncertainty_reason=$6, updated_at=NOW()
     WHERE id=$1 AND organization_id=$2 AND state=$3
       AND (
         $7::text IS NULL OR EXISTS (
           SELECT 1 FROM execution_leases l
           WHERE l.organization_id=$2
             AND l.lease_key=$7
             AND l.owner_id=$8
             AND l.fencing_token=$9::bigint
             AND l.expires_at > NOW()
         )
       )`,
    [
      runId,
      organizationId,
      expectedState,
      state,
      input?.result === undefined ? null : JSON.stringify(input.result),
      input?.uncertaintyReason ?? null,
      guard?.leaseKey ?? null,
      guard?.ownerId ?? null,
      guard?.fencingToken ?? null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(`Execution transition rejected for organization: expected ${expectedState} -> ${state}`);
  }
}

export async function transitionExecutionWithOutbox(
  organizationId: string,
  runId: string,
  expectedState: ExecutionState,
  state: ExecutionState,
  input: {
    eventType: string;
    dedupeKey: string;
    payload: unknown;
    result?: unknown;
    uncertaintyReason?: string;
    leaseGuard?: ExecutionLeaseGuard;
  },
): Promise<string> {
  if (!input.eventType) throw new Error("Outbox eventType is required");
  if (!input.dedupeKey) throw new Error("Outbox dedupeKey is required");

  const guard = input.leaseGuard;
  const result = await db.query(
    `WITH transitioned AS (
       UPDATE execution_runs
       SET state=$4, result=COALESCE($5::jsonb,result), uncertainty_reason=$6, updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND state=$3
         AND (
           $7::text IS NULL OR EXISTS (
             SELECT 1 FROM execution_leases l
             WHERE l.organization_id=$2
               AND l.lease_key=$7
               AND l.owner_id=$8
               AND l.fencing_token=$9::bigint
               AND l.expires_at > NOW()
           )
         )
       RETURNING id, organization_id
     )
     INSERT INTO execution_outbox (organization_id, execution_run_id, event_type, dedupe_key, payload)
     SELECT organization_id, id, $10, $11, $12::jsonb
     FROM transitioned
     RETURNING id`,
    [
      runId,
      organizationId,
      expectedState,
      state,
      input.result === undefined ? null : JSON.stringify(input.result),
      input.uncertaintyReason ?? null,
      guard?.leaseKey ?? null,
      guard?.ownerId ?? null,
      guard?.fencingToken ?? null,
      input.eventType,
      input.dedupeKey,
      JSON.stringify(input.payload),
    ],
  );

  if (result.rowCount !== 1) {
    throw new Error(`Execution transition with outbox rejected for organization: expected ${expectedState} -> ${state}`);
  }
  return String(result.rows[0].id);
}

export async function recordExecutionAttempt(input: { organizationId: string; runId: string; attempt: number; outcome: "started" | "succeeded" | "failed" | "uncertain"; errorCode?: string; errorMessage?: string }): Promise<void> {
  const result = await db.query(
    `INSERT INTO execution_attempts (execution_run_id, attempt, outcome, error_code, error_message, finished_at)
     SELECT r.id,$3,$4,$5,$6,CASE WHEN $4='started' THEN NULL ELSE NOW() END
     FROM execution_runs r
     WHERE r.id=$1 AND r.organization_id=$2
     ON CONFLICT (execution_run_id, attempt) DO UPDATE SET outcome=EXCLUDED.outcome, error_code=EXCLUDED.error_code, error_message=EXCLUDED.error_message, finished_at=EXCLUDED.finished_at
     RETURNING id`,
    [input.runId, input.organizationId, input.attempt, input.outcome, input.errorCode ?? null, input.errorMessage?.slice(0, 1000) ?? null],
  );
  if (result.rowCount !== 1) throw new Error("Execution run not found for organization");
}
