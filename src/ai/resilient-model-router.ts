import type { ModelProvider, ModelRouter } from "@/ai/model-provider";

export type ModelCapability = "reasoning" | "research" | "fast" | "safety";

export class ResilientModelRouter implements ModelRouter {
  constructor(private readonly providers: Record<ModelCapability, ModelProvider[]>) {}

  route(capability: ModelCapability): ModelProvider {
    const candidates = this.providers[capability];
    if (!candidates?.length) throw new Error(`No model provider configured for ${capability}`);
    return candidates[0];
  }

  candidates(capability: ModelCapability): readonly ModelProvider[] {
    return this.providers[capability] ?? [];
  }
}
