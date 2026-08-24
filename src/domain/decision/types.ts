export type DecisionStatus = "draft" | "analyzing" | "ready" | "decided" | "executing" | "completed" | "cancelled";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface DecisionOption {
  id: string;
  title: string;
  description: string;
  benefits: string[];
  risks: string[];
  estimatedImpact?: number;
  confidence: ConfidenceLevel;
}

export interface DecisionEvidence {
  id: string;
  source: string;
  summary: string;
  capturedAt: string;
}

export interface Decision {
  id: string;
  organizationId: string;
  title: string;
  objective: string;
  context: string;
  status: DecisionStatus;
  options: DecisionOption[];
  evidence: DecisionEvidence[];
  selectedOptionId?: string;
  rationale?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionInput {
  organizationId: string;
  title: string;
  objective: string;
  context?: string;
}

export interface DecisionRecommendation {
  decisionId: string;
  recommendedOptionId: string;
  rationale: string;
  confidence: ConfidenceLevel;
  dissent?: string;
  generatedAt: string;
}
