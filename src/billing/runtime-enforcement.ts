import { requireEntitlement } from "@/billing/entitlement-gate";
import { getMonthlyUsageUnits, getOrganizationSubscription } from "@/billing/subscription-repository";

export async function enforceRuntimeBilling(
  organizationId: string,
  feature: "aiBoard" | "autonomousExecution" | "priorityRouting",
): Promise<void> {
  const subscription = await getOrganizationSubscription(organizationId);
  if (!subscription) throw new Error("Active subscription required");
  const monthlyUnits = await getMonthlyUsageUnits(organizationId);
  requireEntitlement({
    plan: subscription.planCode,
    subscriptionState: subscription.state,
    feature,
    monthlyUnits,
  });
}
