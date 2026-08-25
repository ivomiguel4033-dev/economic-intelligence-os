import { db } from "@/infrastructure/database/postgres";
import { estimateModelCost } from "@/billing/model-pricing";

export interface UsageRecordInput {
  organizationId: string;
  provider: string;
  model: string;
  capability: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: Record<string, unknown>;
}

export async function recordModelUsage(input: UsageRecordInput): Promise<number> {
  const inputTokens = Math.max(0, input.inputTokens ?? 0);
  const outputTokens = Math.max(0, input.outputTokens ?? 0);
  const estimatedCostUsd = estimateModelCost(input.provider, input.model, inputTokens, outputTokens);
  await db.query(
    `INSERT INTO usage_ledger (organization_id, event_type, provider, model, capability, input_tokens, output_tokens, estimated_cost_usd, billable_units, metadata)
     VALUES ($1,'model_call',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [input.organizationId, input.provider, input.model, input.capability, inputTokens, outputTokens, estimatedCostUsd, inputTokens + outputTokens, JSON.stringify(input.metadata ?? {})],
  );
  return estimatedCostUsd;
}
