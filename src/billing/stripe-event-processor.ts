import { syncSubscription } from "@/billing/subscription-sync";
import type { PlanCode } from "@/billing/entitlements";
import type { SubscriptionState } from "@/billing/billing-state";

interface StripeSubscriptionObject {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string; metadata?: Record<string, string> } }> };
}

function mapState(status: string): SubscriptionState {
  if (status === "trialing" || status === "active" || status === "past_due" || status === "paused" || status === "canceled") return status;
  if (status === "unpaid" || status === "incomplete" || status === "incomplete_expired") return "past_due";
  return "paused";
}

function resolvePlan(object: StripeSubscriptionObject): PlanCode {
  const raw = object.metadata?.planCode ?? object.items?.data?.[0]?.price?.metadata?.planCode;
  if (raw === "starter" || raw === "growth" || raw === "enterprise") return raw;
  throw new Error("Stripe subscription is missing a valid planCode metadata value");
}

export async function processStripeEvent(event: { type: string; data?: { object?: StripeSubscriptionObject } }): Promise<void> {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return;
  const object = event.data?.object;
  if (!object?.id || !object.customer) throw new Error("Invalid Stripe subscription event payload");
  const organizationId = object.metadata?.organizationId;
  if (!organizationId) throw new Error("Stripe subscription is missing organizationId metadata");
  await syncSubscription({
    organizationId,
    stripeCustomerId: object.customer,
    stripeSubscriptionId: object.id,
    planCode: resolvePlan(object),
    state: event.type === "customer.subscription.deleted" ? "canceled" : mapState(object.status),
    currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : undefined,
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
  });
}
