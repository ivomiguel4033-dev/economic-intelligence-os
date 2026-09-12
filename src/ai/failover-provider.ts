import type { ModelProvider, ModelRequest, ModelResponse } from "@/ai/model-provider";

const DEFAULT_TIMEOUT_MS = 30_000;

function assertTimeoutMs(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("AI provider timeout must be a positive safe integer");
  }
}

export class FailoverProvider implements ModelProvider {
  readonly name = "failover";
  private readonly timeoutMs: number;

  constructor(
    private readonly providers: readonly ModelProvider[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!providers.length) throw new Error("At least one AI provider is required");
    assertTimeoutMs(timeoutMs);
    this.timeoutMs = timeoutMs;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const failures: string[] = [];

    for (const provider of this.providers) {
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${provider.name} timed out`)),
            this.timeoutMs,
          );
        });

        return await Promise.race([provider.generate(request), timeoutPromise]);
      } catch (error) {
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }

    throw new Error(`All AI providers failed: ${failures.join(" | ")}`);
  }
}
