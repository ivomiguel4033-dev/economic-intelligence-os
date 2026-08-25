export type IntelligenceDomain = "finance" | "legal" | "coding" | "research" | "operations" | "sales" | "general";

export interface DomainPerformance {
  domain: IntelligenceDomain;
  modelId: string;
  factuality: number;
  reasoning: number;
  safety: number;
  outcomeQuality: number;
  latency: number;
  costEfficiency: number;
}

export function domainScore(performance: DomainPerformance): number {
  const weights = performance.domain === "legal" || performance.domain === "finance"
    ? { factuality: 0.3, reasoning: 0.2, safety: 0.2, outcome: 0.2, latency: 0.05, cost: 0.05 }
    : performance.domain === "coding"
      ? { factuality: 0.15, reasoning: 0.25, safety: 0.1, outcome: 0.3, latency: 0.1, cost: 0.1 }
      : { factuality: 0.2, reasoning: 0.25, safety: 0.15, outcome: 0.25, latency: 0.075, cost: 0.075 };

  return performance.factuality * weights.factuality +
    performance.reasoning * weights.reasoning +
    performance.safety * weights.safety +
    performance.outcomeQuality * weights.outcome +
    performance.latency * weights.latency +
    performance.costEfficiency * weights.cost;
}
