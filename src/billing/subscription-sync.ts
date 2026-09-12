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
  stripeEventCreatedAt: number;
}

export async function syncSubscription(snapshot: SubscriptionSnapshot): Promise<"applied" | "stale"> {
  const result = await db.query(
    `INSERT INTO billing_customers (
      organization_id, stripe_customer_id, stripe_subscription_id, plan_code,
      subscription_state, current_period_end, cancel_at_period_end,
      last_stripe_event_created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT (organization_id) DO UPDATE SET
      stripe_customer_id=EXCLUDED.stripe_customer_id,
      stripe_subscription_id=EXCLUDED.stripe_subscription_id,
      plan_code=EXCLUDED.plan_code,
      subscription_state=EXCLUDED.subscription_state,
      current_period_end=EXCLUDED.current_period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,
      last_stripe_event_created_at=EXCLUDED.last_stripe_event_created_at,
      updated_at=now()
    WHERE (billing_customers.stripe_customer_id IS NULL
       OR billing_customers.stripe_customer_id=EXCLUDED.stripe_customer_id)
      AND (billing_customers.last_stripe_event_created_at IS NULL
       OR billing_customers.last_stripe_event_created_at < EXCLUDED.last_stripe_event_created_at)
    RETURNING organization_id`,
    [
      snapshot.organizationId,
      snapshot.stripeCustomerId,
      snapshot.stripeSubscriptionId,
      snapshot.planCode,
      snapshot.state,
      snapshot.currentPeriodEnd ?? null,
      snapshot.cancelAtPeriodEnd,
      snapshot.stripeEventCreatedAt,
    ],
  );

  if (result.rowCount) return "applied";

  const existing = await db.query<{ stripe_customer_id: string | null; last_stripe_event_created_at: string | null }>(
    `SELECT stripe_customer_id, last_stripe_event_created_at
     FROM billing_customers
     WHERE organization_id=$1`,
    [snapshot.organizationId],
  );
  const row = existing.rows[0];
  if (row && row.stripe_customer_id === snapshot.stripeCustomerId) {
    const lastCreatedAt = row.last_stripe_event_created_at === null ? null : Number(row.last_stripe_event_created_at);
    if (lastCreatedAt !== null && lastCreatedAt >= snapshot.stripeEventCreatedAt) return "stale";
  }

  throw new Error(`Stripe customer mismatch for organization ${snapshot.organizationId}`);
}
