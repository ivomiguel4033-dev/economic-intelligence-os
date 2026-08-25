export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const PRICES: Record<string, ModelPrice> = {};

export function estimateModelCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[`${provider}:${model}`];
  if (!price) return 0;
  const input = Math.max(0, inputTokens) / 1_000_000 * price.inputPerMillionUsd;
  const output = Math.max(0, outputTokens) / 1_000_000 * price.outputPerMillionUsd;
  return Number((input + output).toFixed(8));
}
