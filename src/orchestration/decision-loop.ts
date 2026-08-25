import type { Decision } from "@/domain/decision/types";
import type { BrainHit } from "@/company-brain/types";
import type { BoardVerdict } from "@/ai/ai-board";
import type { ConsensusResult } from "@/intelligence/ensemble-consensus";
import type { DecisionGateResult } from "@/trust/decision-gate";
import type { ExecutionDecision } from "@/execution/execution-policy";

export interface DecisionLoopInput {
  decision: Decision;
  evidence: BrainHit[];
  boardVerdict: BoardVerdict;
  consensus: ConsensusResult | null;
  gate: DecisionGateResult;
  execution: ExecutionDecision;
}

export interface DecisionLoopResult {
  decisionId: string;
  phase: "blocked" | "approval-required" | "ready-to-execute";
  reasons: string[];
  evidenceCount: number;
  boardConfidence: number;
  consensusAgreement?: number;
}

export function resolveDecisionLoop(input: DecisionLoopInput): DecisionLoopResult {
  const reasons = [...input.gate.reasons, ...input.execution.reasons];

  if (!input.gate.allowed && !input.gate.requiresHumanApproval) {
    return {
      decisionId: input.decision.id,
      phase: "blocked",
      reasons: reasons.length ? reasons : ["Decision blocked by policy"],
      evidenceCount: input.evidence.length,
      boardConfidence: input.boardVerdict.confidence,
      consensusAgreement: input.consensus?.agreement,
    };
  }

  if (input.gate.requiresHumanApproval || input.execution.approvalRequired) {
    return {
      decisionId: input.decision.id,
      phase: "approval-required",
      reasons,
      evidenceCount: input.evidence.length,
      boardConfidence: input.boardVerdict.confidence,
      consensusAgreement: input.consensus?.agreement,
    };
  }

  return {
    decisionId: input.decision.id,
    phase: "ready-to-execute",
    reasons,
    evidenceCount: input.evidence.length,
    boardConfidence: input.boardVerdict.confidence,
    consensusAgreement: input.consensus?.agreement,
  };
}
