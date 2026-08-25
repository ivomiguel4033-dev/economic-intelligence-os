export type SubscriptionState = "trialing" | "active" | "past_due" | "paused" | "canceled";

export interface BillingAccess {
  canUsePlatform: boolean;
  canExecutePaidActions: boolean;
  reason?: string;
}

export function accessForSubscription(state: SubscriptionState): BillingAccess {
  switch (state) {
    case "trialing":
    case "active":
      return { canUsePlatform: true, canExecutePaidActions: true };
    case "past_due":
      return { canUsePlatform: true, canExecutePaidActions: false, reason: "Payment recovery required" };
    case "paused":
      return { canUsePlatform: false, canExecutePaidActions: false, reason: "Subscription paused" };
    case "canceled":
      return { canUsePlatform: false, canExecutePaidActions: false, reason: "Subscription canceled" };
  }
}
