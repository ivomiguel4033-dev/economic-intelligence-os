export interface ModelPrice {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function estimateModelCost(price: ModelPrice, usage: TokenUsage): number {
  const input = Math.max(0, usage.inputTokens) / 1_000_000 * price.inputPerMillionUsd;
  const output = Math.max(0, usage.outputTokens) / 1_000_000 * price.outputPerMillionUsd;
  return Number((input + output).toFixed(8));
}

export class PriceCatalog {
  private readonly prices = new Map<string, ModelPrice>();

  register(price: ModelPrice) {
    this.prices.set(`${price.provider}:${price.model}`, price);
  }

  find(provider: string, model: string): ModelPrice | undefined {
    return this.prices.get(`${provider}:${model}`);
  }
}
