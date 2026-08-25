import { db } from "@/infrastructure/database/postgres";
import type { PlanCode } from "@/billing/entitlements";
import type { SubscriptionState } from "@/billing/billing-state";

export interface OrganizationSubscription {
  organizationId: string;
  planCode: PlanCode;
  state: SubscriptionState;
  currentPeriodEnd?: string;
}

export async function getOrganizationSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
  const result = await db.query(
    `SELECT organization_id, plan_code, subscription_state, current_period_end
     FROM billing_customers WHERE organization_id=$1 LIMIT 1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    organizationId: String(row.organization_id),
    planCode: row.plan_code as PlanCode,
    state: row.subscription_state as SubscriptionState,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : undefined,
  };
}

export async function getMonthlyUsageUnits(organizationId: string): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(billable_units),0)::bigint AS units
     FROM usage_ledger
     WHERE organization_id=$1 AND created_at >= date_trunc('month', now())`,
    [organizationId],
  );
  return Number(result.rows[0]?.units ?? 0);
}
