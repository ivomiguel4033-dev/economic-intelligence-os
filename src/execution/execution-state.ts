import { db } from "@/infrastructure/database/postgres";

export type ExecutionState = "pending" | "running" | "succeeded" | "failed" | "uncertain" | "dead_lettered";

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

export async function transitionExecution(runId: string, state: ExecutionState, input?: { result?: unknown; uncertaintyReason?: string }): Promise<void> {
  await db.query(
    `UPDATE execution_runs SET state=$2, result=COALESCE($3::jsonb,result), uncertainty_reason=$4, updated_at=NOW() WHERE id=$1`,
    [runId, state, input?.result === undefined ? null : JSON.stringify(input.result), input?.uncertaintyReason ?? null],
  );
}

export async function recordExecutionAttempt(input: { runId: string; attempt: number; outcome: "started" | "succeeded" | "failed" | "uncertain"; errorCode?: string; errorMessage?: string }): Promise<void> {
  await db.query(
    `INSERT INTO execution_attempts (execution_run_id, attempt, outcome, error_code, error_message, finished_at)
     VALUES ($1,$2,$3,$4,$5,CASE WHEN $3='started' THEN NULL ELSE NOW() END)
     ON CONFLICT (execution_run_id, attempt) DO UPDATE SET outcome=EXCLUDED.outcome, error_code=EXCLUDED.error_code, error_message=EXCLUDED.error_message, finished_at=EXCLUDED.finished_at`,
    [input.runId, input.attempt, input.outcome, input.errorCode ?? null, input.errorMessage?.slice(0, 1000) ?? null],
  );
}
