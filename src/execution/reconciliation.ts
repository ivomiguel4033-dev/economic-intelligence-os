import { db } from "@/infrastructure/database/postgres";

export interface ReconciliationCandidate {
  runId: string;
  organizationId: string;
  actionId: string;
  actionType: string;
  uncertaintyReason?: string;
}

export async function listUncertainExecutions(limit = 100): Promise<ReconciliationCandidate[]> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const result = await db.query(
    `SELECT id, organization_id, action_id, action_type, uncertainty_reason
     FROM execution_runs WHERE state='uncertain'
     ORDER BY updated_at ASC LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map((row) => ({
    runId: String(row.id),
    organizationId: String(row.organization_id),
    actionId: String(row.action_id),
    actionType: String(row.action_type),
    uncertaintyReason: row.uncertainty_reason ? String(row.uncertainty_reason) : undefined,
  }));
}
