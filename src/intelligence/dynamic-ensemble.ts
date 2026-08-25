import type { DomainPerformance, IntelligenceDomain } from "@/evaluation/domain-score";
import { domainScore } from "@/evaluation/domain-score";

export interface EnsembleSelection {
  domain: IntelligenceDomain;
  selectedModelIds: string[];
  rationale: string[];
}

export function selectDynamicEnsemble(
  domain: IntelligenceDomain,
  performances: DomainPerformance[],
  maxModels = 3,
): EnsembleSelection {
  const ranked = performances
    .filter((item) => item.domain === domain)
    .sort((a, b) => domainScore(b) - domainScore(a));

  const selected = ranked.slice(0, Math.max(1, maxModels));
  return {
    domain,
    selectedModelIds: selected.map((item) => item.modelId),
    rationale: selected.map((item) => `${item.modelId}: ${domainScore(item).toFixed(3)}`),
  };
}
