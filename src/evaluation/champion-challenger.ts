export interface CandidateMetrics {
  id: string;
  quality: number;
  safety: number;
  reliability: number;
  latency: number;
  costEfficiency: number;
  sampleSize: number;
}

export interface PromotionDecision {
  promote: boolean;
  scoreDelta: number;
  reasons: string[];
}

function score(m: CandidateMetrics): number {
  return m.quality * 0.4 + m.safety * 0.25 + m.reliability * 0.2 + m.latency * 0.075 + m.costEfficiency * 0.075;
}

export function compareChampion(champion: CandidateMetrics, challenger: CandidateMetrics): PromotionDecision {
  const reasons: string[] = [];
  if (challenger.sampleSize < 30) reasons.push("Insufficient challenger sample size");
  if (challenger.safety < champion.safety) reasons.push("Safety regression");
  if (challenger.reliability < champion.reliability - 0.02) reasons.push("Reliability regression");
  const scoreDelta = score(challenger) - score(champion);
  if (scoreDelta < 0.02) reasons.push("Quality/value improvement below promotion margin");
  return { promote: reasons.length === 0, scoreDelta, reasons };
}
