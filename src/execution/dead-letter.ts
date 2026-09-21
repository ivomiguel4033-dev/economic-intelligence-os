import { db } from "@/infrastructure/database/postgres";
import type { ProposedAction } from "@/execution/execution-policy";

export async function deadLetterAction(action: ProposedAction, reason: string, attempts: number): Promise<void> {
  await db.query(
    `INSERT INTO execution_dead_letters
      (action_id, organization_id, action_type, risk_tier, reason, attempts, payload, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())`,
    [action.id, action.organizationId, action.actionType, action.riskTier, reason, attempts, JSON.stringify(action)],
  );
}
