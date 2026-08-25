export interface ModelPerformance {
  provider: string;
  model: string;
  capability: string;
  quality: number;
  reliability: number;
  latencyScore: number;
  costScore: number;
  sampleSize: number;
}

export interface RoutingWeights {
  quality: number;
  reliability: number;
  latency: number;
  cost: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function modelUtility(performance: ModelPerformance, weights: RoutingWeights): number {
  const evidenceFactor = Math.min(1, Math.log10(Math.max(1, performance.sampleSize) + 1));
  const raw = clamp(performance.quality) * weights.quality +
    clamp(performance.reliability) * weights.reliability +
    clamp(performance.latencyScore) * weights.latency +
    clamp(performance.costScore) * weights.cost;
  return raw * (0.6 + 0.4 * evidenceFactor);
}

export function rankModels(models: ModelPerformance[], weights: RoutingWeights): ModelPerformance[] {
  return [...models].sort((a, b) => modelUtility(b, weights) - modelUtility(a, weights));
}
