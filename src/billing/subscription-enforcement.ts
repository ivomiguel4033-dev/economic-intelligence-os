import { requireEntitlement } from "@/billing/entitlement-gate";
import type { PlanCode } from "@/billing/entitlements";
import type { SubscriptionState } from "@/billing/billing-state";

export interface SubscriptionEnforcementInput {
  plan: PlanCode;
  state: SubscriptionState;
  monthlyUnits: number;
  wantsAutonomousExecution: boolean;
}

export function enforceOrchestrationSubscription(input: SubscriptionEnforcementInput): void {
  requireEntitlement({
    plan: input.plan,
    subscriptionState: input.state,
    feature: "aiBoard",
    monthlyUnits: input.monthlyUnits,
  });

  if (input.wantsAutonomousExecution) {
    requireEntitlement({
      plan: input.plan,
      subscriptionState: input.state,
      feature: "autonomousExecution",
      monthlyUnits: input.monthlyUnits,
    });
  }
}
