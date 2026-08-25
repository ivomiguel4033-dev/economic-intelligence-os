import { CircuitBreaker } from "@/operations/circuit-breaker";
import { evaluateExecution, type ProposedAction } from "@/execution/execution-policy";
import { executionIdempotencyKey, type IdempotencyStore } from "@/execution/idempotency";
import { DEFAULT_EXTERNAL_RETRY, retryDelay, type RetryPolicy } from "@/execution/retry-policy";
import { deadLetterAction } from "@/execution/dead-letter";
import { incrementMetric } from "@/observability/service-metrics";

export interface ExternalExecutor<T> {
  execute(action: ProposedAction): Promise<T>;
}

export interface ResilientExecutionOptions<T> {
  idempotencyStore: IdempotencyStore<T>;
  retryPolicy?: RetryPolicy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ResilientExternalExecutor<T> {
  constructor(
    private readonly executor: ExternalExecutor<T>,
    private readonly options: ResilientExecutionOptions<T>,
    private readonly breaker = new CircuitBreaker(),
  ) {}

  async execute(action: ProposedAction): Promise<T> {
    const decision = evaluateExecution(action);
    if (!decision.execute) {
      throw new Error(`Execution policy denied action: ${decision.reasons.join("; ") || "human approval required"}`);
    }
    if (!action.externalSideEffect) throw new Error("ResilientExternalExecutor only accepts external side-effect actions");
    if (!this.breaker.canExecute()) throw new Error("External execution circuit is open");

    const key = executionIdempotencyKey({
      organizationId: action.organizationId,
      actionId: action.id,
      actionType: action.actionType,
    });
    const existing = await this.options.idempotencyStore.get(key);
    if (existing !== undefined) return existing;

    const retryPolicy = this.options.retryPolicy ?? DEFAULT_EXTERNAL_RETRY;
    incrementMetric("ai_requests_total");
    let lastError: unknown;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      try {
        const result = await this.executor.execute(action);
        await this.options.idempotencyStore.putIfAbsent(key, result);
        this.breaker.success();
        return result;
      } catch (error) {
        lastError = error;
        this.breaker.failure();
        incrementMetric("ai_failures_total");
        if (attempt >= retryPolicy.maxAttempts || !this.breaker.canExecute()) break;
        await sleep(retryDelay(attempt, retryPolicy));
      }
    }

    const message = lastError instanceof Error ? lastError.message : "External execution failed";
    await deadLetterAction(action, message, retryPolicy.maxAttempts);
    throw lastError instanceof Error ? lastError : new Error(message);
  }

  circuitState() {
    return this.breaker.snapshot();
  }
}
