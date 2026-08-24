import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";

export class FailoverProvider implements ModelProvider {
  readonly name = "failover";

  constructor(
    private readonly providers: readonly ModelProvider[],
    private readonly timeoutMs = 30_000,
  ) {
    if (!providers.length) throw new Error("At least one AI provider is required");
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const failures: string[] = [];

    for (const provider of this.providers) {
      try {
        return await Promise.race([
          provider.generate(request),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${provider.name} timed out`)), this.timeoutMs),
          ),
        ]);
      } catch (error) {
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    throw new Error(`All AI providers failed: ${failures.join(" | ")}`);
  }
}
