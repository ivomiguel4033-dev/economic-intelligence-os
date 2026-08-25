export type RiskTier = "low" | "medium" | "high" | "critical";

export interface RiskPolicy {
  tier: RiskTier;
  humanApproval: boolean;
  minimumConfidence: number;
  requireEvidence: boolean;
  allowExternalExecution: boolean;
}

export const RISK_POLICIES: Record<RiskTier, RiskPolicy> = {
  low: { tier: "low", humanApproval: false, minimumConfidence: 0.65, requireEvidence: false, allowExternalExecution: true },
  medium: { tier: "medium", humanApproval: false, minimumConfidence: 0.75, requireEvidence: true, allowExternalExecution: true },
  high: { tier: "high", humanApproval: true, minimumConfidence: 0.85, requireEvidence: true, allowExternalExecution: false },
  critical: { tier: "critical", humanApproval: true, minimumConfidence: 0.95, requireEvidence: true, allowExternalExecution: false },
};

export function policyForRisk(tier: RiskTier): RiskPolicy {
  return RISK_POLICIES[tier];
}
