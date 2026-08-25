import { AIBoard } from "@/ai/ai-board";
import { providersFromEnvironment } from "@/ai/provider-env";
import type { ModelProvider, ModelRouter } from "@/ai/model-provider";
import { FailoverProvider } from "@/ai/failover-provider";
import { OrchestrationRuntime } from "@/orchestration/runtime";

class EnvironmentModelRouter implements ModelRouter {
  constructor(private readonly providers: ModelProvider[]) {}

  route(_capability: "reasoning" | "research" | "fast" | "safety"): ModelProvider {
    if (!this.providers.length) throw new Error("No AI providers configured in environment");
    return this.providers.length === 1 ? this.providers[0] : new FailoverProvider(this.providers);
  }
}

export function createOrchestrationRuntime(): OrchestrationRuntime {
  const providers = providersFromEnvironment();
  const router = new EnvironmentModelRouter(providers);
  return new OrchestrationRuntime(new AIBoard(router));
}
