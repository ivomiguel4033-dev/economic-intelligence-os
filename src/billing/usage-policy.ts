export interface UsageSnapshot {
  decisionsUsed: number;
  aiCostUsd: number;
}

export interface PlanLimits {
  includedDecisions: number;
  includedAiCostUsd: number;
  hardMonthlyAiCostUsd?: number;
}

export interface UsagePolicyResult {
  allowed: boolean;
  softLimitExceeded: boolean;
  hardLimitExceeded: boolean;
  reasons: string[];
}

export function evaluateUsagePolicy(usage: UsageSnapshot, limits: PlanLimits): UsagePolicyResult {
  const reasons: string[] = [];
  const softLimitExceeded = usage.decisionsUsed >= limits.includedDecisions || usage.aiCostUsd >= limits.includedAiCostUsd;
  const hardLimitExceeded = limits.hardMonthlyAiCostUsd !== undefined && usage.aiCostUsd >= limits.hardMonthlyAiCostUsd;
  if (usage.decisionsUsed >= limits.includedDecisions) reasons.push("Included decision allowance exceeded");
  if (usage.aiCostUsd >= limits.includedAiCostUsd) reasons.push("Included AI cost allowance exceeded");
  if (hardLimitExceeded) reasons.push("Hard monthly AI cost limit exceeded");
  return { allowed: !hardLimitExceeded, softLimitExceeded, hardLimitExceeded, reasons };
}
