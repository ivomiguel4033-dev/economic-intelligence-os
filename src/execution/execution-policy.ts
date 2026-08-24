import type { RiskTier } from "@/security/risk-policy";
import { policyForRisk } from "@/security/risk-policy";

export interface ProposedAction {
  id: string;
  organizationId: string;
  actionType: string;
  reversible: boolean;
  externalSideEffect: boolean;
  riskTier: RiskTier;
  confidence: number;
  evidenceCount: number;
}

export interface ExecutionDecision {
  execute: boolean;
  approvalRequired: boolean;
  reasons: string[];
}

export function evaluateExecution(action: ProposedAction): ExecutionDecision {
  const policy = policyForRisk(action.riskTier);
  const reasons: string[] = [];
  if (action.confidence < policy.minimumConfidence) reasons.push("Confidence below policy threshold");
  if (policy.requireEvidence && action.evidenceCount === 0) reasons.push("Evidence required");
  if (action.externalSideEffect && !policy.allowExternalExecution) reasons.push("External execution blocked for this risk tier");
  if (!action.reversible && action.riskTier !== "low") reasons.push("Irreversible action requires review");
  const approvalRequired = policy.humanApproval || reasons.length > 0;
  return { execute: !approvalRequired, approvalRequired, reasons };
}
