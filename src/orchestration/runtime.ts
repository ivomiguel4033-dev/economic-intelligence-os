import type { Decision } from "@/domain/decision/types";
import type { AIBoard, BoardVerdict } from "@/ai/ai-board";
import type { SupportedClaim } from "@/trust/provenance";
import { evaluateDecisionGate } from "@/trust/decision-gate";
import { evaluateExecution, type ProposedAction } from "@/execution/execution-policy";

export type OrchestrationStatus = "blocked" | "approval-required" | "ready-to-execute";

export interface OrchestrationResult {
  decisionId: string;
  board: BoardVerdict;
  status: OrchestrationStatus;
  gateReasons: string[];
  executionReasons: string[];
  generatedAt: string;
}

export class OrchestrationRuntime {
  constructor(private readonly board: AIBoard) {}

  async run(decision: Decision, claims: SupportedClaim[], action: ProposedAction): Promise<OrchestrationResult> {
    const board = await this.board.deliberate(decision);
    const gate = evaluateDecisionGate({
      confidence: board.confidence,
      claims,
      highImpact: action.riskTier === "high" || action.riskTier === "critical",
    });

    if (!gate.allowed && !gate.requiresHumanApproval) {
      return { decisionId: decision.id, board, status: "blocked", gateReasons: gate.reasons, executionReasons: [], generatedAt: new Date().toISOString() };
    }

    const execution = evaluateExecution(action);
    const status: OrchestrationStatus = execution.execute
      ? "ready-to-execute"
      : "approval-required";

    return {
      decisionId: decision.id,
      board,
      status,
      gateReasons: gate.reasons,
      executionReasons: execution.reasons,
      generatedAt: new Date().toISOString(),
    };
  }
}
