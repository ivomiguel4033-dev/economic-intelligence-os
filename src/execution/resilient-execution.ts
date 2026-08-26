import { CircuitBreaker } from "@/operations/circuit-breaker";
import { evaluateExecution, type ProposedAction } from "@/execution/execution-policy";
import { executionIdempotencyKey, type IdempotencyStore } from "@/execution/idempotency";
import { DEFAULT_EXTERNAL_RETRY, retryDelay, type RetryPolicy } from "@/execution/retry-policy";
import { deadLetterAction } from "@/execution/dead-letter";
import { createExecutionRun, recordExecutionAttempt, transitionExecution, type ExecutionLeaseGuard } from "@/execution/execution-state";
import { ExecutionLease } from "@/execution/execution-lease";
import { incrementMetric } from "@/observability/service-metrics";

export interface ExternalExecutor<T> { execute(action: ProposedAction): Promise<T>; }
export interface ExternalExecutionError extends Error { outcomeUncertain?: boolean; retryable?: boolean; code?: string; }
export interface ResilientExecutionOptions<T> { idempotencyStore: IdempotencyStore<T>; retryPolicy?: RetryPolicy; }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function executionError(error: unknown): ExternalExecutionError { return error instanceof Error ? error as ExternalExecutionError : new Error("External execution failed"); }

export class ResilientExternalExecutor<T> {
  constructor(private readonly executor: ExternalExecutor<T>, private readonly options: ResilientExecutionOptions<T>, private readonly breaker = new CircuitBreaker()) {}

  async execute(action: ProposedAction): Promise<T> {
    const decision = evaluateExecution(action);
    if (!decision.execute) throw new Error(`Execution policy denied action: ${decision.reasons.join("; ") || "human approval required"}`);
    if (!action.externalSideEffect) throw new Error("ResilientExternalExecutor only accepts external side-effect actions");
    if (!this.breaker.canExecute()) throw new Error("External execution circuit is open");

    const key = executionIdempotencyKey({ organizationId: action.organizationId, actionId: action.id, actionType: action.actionType });
    const lease = new ExecutionLease(action.organizationId);
    const leaseKey = `execute:${key}`;
    const fence = await lease.acquireWithFence(leaseKey, 120);
    if (!fence) throw new Error("Execution already in progress");
    const leaseGuard: ExecutionLeaseGuard = { leaseKey, ownerId: fence.ownerId, fencingToken: fence.fencingToken };

    try {
      const existing = await this.options.idempotencyStore.get(key);
      if (existing !== undefined) return existing;

      const runId = await createExecutionRun({ organizationId: action.organizationId, actionId: action.id, actionType: action.actionType, idempotencyKey: key });
      await transitionExecution(action.organizationId, runId, "pending", "running", { leaseGuard });
      const retryPolicy = this.options.retryPolicy ?? DEFAULT_EXTERNAL_RETRY;
      incrementMetric("ai_requests_total");
      let lastError: ExternalExecutionError | undefined;
      let attempts = 0;

      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
        attempts = attempt;
        if (!(await lease.renew(leaseKey, 120))) throw new Error("Execution lease lost before attempt");
        await recordExecutionAttempt({ organizationId: action.organizationId, runId, attempt, outcome: "started" });
        try {
          const result = await this.executor.execute(action);
          if (!(await lease.renew(leaseKey, 120))) throw new Error("Execution lease lost after external side effect");
          await this.options.idempotencyStore.putIfAbsent(key, result);
          await recordExecutionAttempt({ organizationId: action.organizationId, runId, attempt, outcome: "succeeded" });
          await transitionExecution(action.organizationId, runId, "running", "succeeded", { result, leaseGuard });
          this.breaker.success();
          return result;
        } catch (rawError) {
          const error = executionError(rawError);
          lastError = error;
          incrementMetric("ai_failures_total");
          if (error.outcomeUncertain) {
            await recordExecutionAttempt({ organizationId: action.organizationId, runId, attempt, outcome: "uncertain", errorCode: error.code, errorMessage: error.message });
            await transitionExecution(action.organizationId, runId, "running", "uncertain", { uncertaintyReason: error.message, leaseGuard });
            this.breaker.failure();
            throw error;
          }
          await recordExecutionAttempt({ organizationId: action.organizationId, runId, attempt, outcome: "failed", errorCode: error.code, errorMessage: error.message });
          this.breaker.failure();
          if (error.retryable === false || attempt >= retryPolicy.maxAttempts || !this.breaker.canExecute()) break;
          await sleep(retryDelay(attempt, retryPolicy));
        }
      }

      const message = lastError?.message ?? "External execution failed";
      await transitionExecution(action.organizationId, runId, "running", "failed", { leaseGuard });
      await deadLetterAction(action, message, attempts);
      await transitionExecution(action.organizationId, runId, "failed", "dead_lettered", { leaseGuard });
      throw lastError ?? new Error(message);
    } finally {
      await lease.release(leaseKey);
    }
  }

  circuitState() { return this.breaker.snapshot(); }
}
