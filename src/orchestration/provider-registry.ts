import type { ModelProvider } from "@/ai/model-provider";
import { FailoverProvider } from "@/ai/failover-provider";

export type RuntimeCapability = "reasoning" | "research" | "fast" | "safety";

export class ProviderRegistry {
  private readonly providers = new Map<RuntimeCapability, ModelProvider[]>();

  register(capability: RuntimeCapability, provider: ModelProvider) {
    const current = this.providers.get(capability) ?? [];
    this.providers.set(capability, [...current, provider]);
  }

  resolve(capability: RuntimeCapability): ModelProvider {
    const candidates = this.providers.get(capability) ?? [];
    if (!candidates.length) throw new Error(`No runtime provider registered for ${capability}`);
    return candidates.length === 1 ? candidates[0] : new FailoverProvider(candidates);
  }

  list(capability: RuntimeCapability): readonly ModelProvider[] {
    return this.providers.get(capability) ?? [];
  }
}
