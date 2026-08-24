import type { SupportedClaim } from "@/trust/provenance";

export interface DecisionGateInput {
  confidence: number;
  claims: SupportedClaim[];
  highImpact: boolean;
}

export interface DecisionGateResult {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reasons: string[];
}

export function evaluateDecisionGate(input: DecisionGateInput): DecisionGateResult {
  const reasons: string[] = [];
  const unsupported = input.claims.filter((claim) => claim.status === "insufficient");
  const conflicted = input.claims.filter((claim) => claim.status === "conflicted");

  if (input.confidence < 0.6) reasons.push("Overall confidence below execution threshold");
  if (unsupported.length) reasons.push(`${unsupported.length} claim(s) lack sufficient evidence`);
  if (conflicted.length) reasons.push(`${conflicted.length} claim(s) have conflicting evidence`);

  const requiresHumanApproval = input.highImpact || reasons.length > 0;
  return {
    allowed: !input.highImpact && reasons.length === 0,
    requiresHumanApproval,
    reasons,
  };
}
