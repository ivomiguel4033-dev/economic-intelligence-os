import { db } from "@/infrastructure/database/postgres";
import type { PlanCode } from "@/billing/entitlements";
import type { SubscriptionState } from "@/billing/billing-state";

export interface SubscriptionSnapshot {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planCode: PlanCode;
  state: SubscriptionState;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export async function syncSubscription(snapshot: SubscriptionSnapshot): Promise<void> {
  const result = await db.query(
    `INSERT INTO billing_customers (
      organization_id, stripe_customer_id, stripe_subscription_id, plan_code,
      subscription_state, current_period_end, cancel_at_period_end, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT (organization_id) DO UPDATE SET
      stripe_customer_id=EXCLUDED.stripe_customer_id,
      stripe_subscription_id=EXCLUDED.stripe_subscription_id,
      plan_code=EXCLUDED.plan_code,
      subscription_state=EXCLUDED.subscription_state,
      current_period_end=EXCLUDED.current_period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,
      updated_at=now()
    WHERE billing_customers.stripe_customer_id IS NULL
       OR billing_customers.stripe_customer_id=EXCLUDED.stripe_customer_id
    RETURNING organization_id`,
    [
      snapshot.organizationId,
      snapshot.stripeCustomerId,
      snapshot.stripeSubscriptionId,
      snapshot.planCode,
      snapshot.state,
      snapshot.currentPeriodEnd ?? null,
      snapshot.cancelAtPeriodEnd,
    ],
  );

  if (!result.rowCount) {
    throw new Error(`Stripe customer mismatch for organization ${snapshot.organizationId}`);
  }
}
