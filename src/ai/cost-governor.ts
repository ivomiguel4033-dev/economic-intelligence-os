export interface UsageEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AIBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostUsd: number;
}

export class CostGovernor {
  constructor(private readonly budget: AIBudget) {}

  assertAllowed(usage: UsageEstimate) {
    if (usage.inputTokens > this.budget.maxInputTokens) throw new Error("AI input token budget exceeded");
    if (usage.outputTokens > this.budget.maxOutputTokens) throw new Error("AI output token budget exceeded");
    if (usage.estimatedCostUsd > this.budget.maxEstimatedCostUsd) throw new Error("AI cost budget exceeded");
  }
}
