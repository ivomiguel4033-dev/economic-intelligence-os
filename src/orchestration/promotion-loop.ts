import type { CandidateMetrics, PromotionDecision } from "@/evaluation/champion-challenger";
import { compareChampion } from "@/evaluation/champion-challenger";

export interface PromotionLoopInput {
  capability: string;
  taskType: string;
  champion: CandidateMetrics;
  challengers: CandidateMetrics[];
}

export interface PromotionLoopResult {
  capability: string;
  taskType: string;
  selectedChampion: CandidateMetrics;
  decisions: Array<{ challengerId: string; decision: PromotionDecision }>;
}

export function runPromotionLoop(input: PromotionLoopInput): PromotionLoopResult {
  let selected = input.champion;
  const decisions: PromotionLoopResult["decisions"] = [];

  for (const challenger of input.challengers) {
    const decision = compareChampion(selected, challenger);
    decisions.push({ challengerId: challenger.id, decision });
    if (decision.promote) selected = challenger;
  }

  return {
    capability: input.capability,
    taskType: input.taskType,
    selectedChampion: selected,
    decisions,
  };
}
