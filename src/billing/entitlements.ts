export type PlanCode = "starter" | "growth" | "enterprise";

export interface PlanEntitlements {
  monthlyIncludedUnits: number;
  hardMonthlyUnits: number;
  maxOrganizations: number;
  maxSeats: number;
  aiBoard: boolean;
  autonomousExecution: boolean;
  priorityRouting: boolean;
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = {
  starter: { monthlyIncludedUnits: 1_000_000, hardMonthlyUnits: 1_250_000, maxOrganizations: 1, maxSeats: 5, aiBoard: true, autonomousExecution: false, priorityRouting: false },
  growth: { monthlyIncludedUnits: 5_000_000, hardMonthlyUnits: 6_500_000, maxOrganizations: 3, maxSeats: 25, aiBoard: true, autonomousExecution: true, priorityRouting: true },
  enterprise: { monthlyIncludedUnits: 25_000_000, hardMonthlyUnits: 40_000_000, maxOrganizations: 50, maxSeats: 500, aiBoard: true, autonomousExecution: true, priorityRouting: true },
};

export function entitlementsFor(plan: PlanCode): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan];
}
