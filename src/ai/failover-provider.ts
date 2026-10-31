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
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new Error("AI request aborted");
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;
      let callerAbortHandler: (() => void) | undefined;
      const attemptController = new AbortController();

      try {
        const timeoutError = new Error(`${provider.name} timed out`);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            attemptController.abort(timeoutError);
            reject(timeoutError);
          }, this.timeoutMs);
        });
        const callerAbortPromise = new Promise<never>((_resolve, reject) => {
          if (!request.signal) return;
          callerAbortHandler = () => {
            const reason = request.signal?.reason ?? new Error("AI request aborted");
            attemptController.abort(reason);
            reject(reason);
          };
          request.signal.addEventListener("abort", callerAbortHandler, { once: true });
        });

        return await Promise.race([
          provider.generate({ ...request, signal: attemptController.signal }),
          timeoutPromise,
          callerAbortPromise,
        ]);
      } catch (error) {
        if (request.signal?.aborted) {
          throw request.signal.reason ?? error;
        }
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        if (request.signal && callerAbortHandler) {
          request.signal.removeEventListener("abort", callerAbortHandler);
        }
      }
    }

    throw new Error(`All AI providers failed: ${failures.join(" | ")}`);
  }
}
