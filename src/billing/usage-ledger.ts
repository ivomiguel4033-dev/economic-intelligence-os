import { db } from "@/infrastructure/database/postgres";

export interface UsageEntry {
  organizationId: string;
  decisionId?: string;
  orchestrationRunId?: string;
  provider: string;
  model: string;
  capability: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  billableUnits: number;
}

export async function recordUsage(entry: UsageEntry): Promise<void> {
  await db.query(
    `INSERT INTO usage_ledger (
      organization_id, decision_id, orchestration_run_id, provider, model, capability,
      input_tokens, output_tokens, estimated_cost_usd, billable_units
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [entry.organizationId, entry.decisionId ?? null, entry.orchestrationRunId ?? null,
     entry.provider, entry.model, entry.capability, entry.inputTokens, entry.outputTokens,
     entry.estimatedCostUsd, entry.billableUnits],
  );
}

export async function monthlyUsage(organizationId: string): Promise<{ decisionsUsed: number; aiCostUsd: number }> {
  const result = await db.query(
    `SELECT COUNT(DISTINCT decision_id)::int AS decisions_used,
            COALESCE(SUM(estimated_cost_usd),0)::float8 AS ai_cost_usd
     FROM usage_ledger
     WHERE organization_id = $1
       AND created_at >= date_trunc('month', now())`,
    [organizationId],
  );
  return {
    decisionsUsed: Number(result.rows[0]?.decisions_used ?? 0),
    aiCostUsd: Number(result.rows[0]?.ai_cost_usd ?? 0),
  };
}
