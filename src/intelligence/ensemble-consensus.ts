export interface EnsembleVote {
  memberId: string;
  optionId: string;
  confidence: number;
  historicalAccuracy: number;
  evidenceQuality: number;
}

export interface ConsensusResult {
  optionId: string;
  score: number;
  agreement: number;
  dissenters: string[];
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function ensembleConsensus(votes: EnsembleVote[]): ConsensusResult | null {
  if (!votes.length) return null;
  const scores = new Map<string, number>();
  for (const vote of votes) {
    const weight = clamp(vote.confidence) * 0.4 + clamp(vote.historicalAccuracy) * 0.35 + clamp(vote.evidenceQuality) * 0.25;
    scores.set(vote.optionId, (scores.get(vote.optionId) ?? 0) + weight);
  }
  const [optionId, score] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  const supporters = votes.filter((vote) => vote.optionId === optionId);
  return {
    optionId,
    score,
    agreement: supporters.length / votes.length,
    dissenters: votes.filter((vote) => vote.optionId !== optionId).map((vote) => vote.memberId),
  };
}
