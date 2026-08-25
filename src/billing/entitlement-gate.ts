import { accessForSubscription, type SubscriptionState } from "@/billing/billing-state";
import { entitlementsFor, type PlanCode } from "@/billing/entitlements";

export interface EntitlementRequest {
  plan: PlanCode;
  subscriptionState: SubscriptionState;
  feature: "aiBoard" | "autonomousExecution" | "priorityRouting";
  monthlyUnits: number;
}

export function requireEntitlement(request: EntitlementRequest): void {
  const access = accessForSubscription(request.subscriptionState);
  if (!access.canUsePlatform) throw new Error(access.reason ?? "Subscription access denied");
  const entitlements = entitlementsFor(request.plan);
  if (!entitlements[request.feature]) throw new Error(`Feature ${request.feature} is not included in plan ${request.plan}`);
  if (request.monthlyUnits >= entitlements.hardMonthlyUnits) throw new Error("Monthly hard usage limit reached");
  if (request.feature === "autonomousExecution" && !access.canExecutePaidActions) {
    throw new Error(access.reason ?? "Paid execution is unavailable");
  }
}
