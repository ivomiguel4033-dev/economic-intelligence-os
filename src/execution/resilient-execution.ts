import { CircuitBreaker } from "@/operations/circuit-breaker";
import { evaluateExecution, type ProposedAction } from "@/execution/execution-policy";

export interface ExternalExecutor<T> {
  execute(action: ProposedAction): Promise<T>;
}

export class ResilientExternalExecutor<T> {
  constructor(
    private readonly executor: ExternalExecutor<T>,
    private readonly breaker = new CircuitBreaker(),
  ) {}

  async execute(action: ProposedAction): Promise<T> {
    const decision = evaluateExecution(action);
    if (!decision.execute) {
      throw new Error(`Execution policy denied action: ${decision.reasons.join("; ") || "human approval required"}`);
    }
    if (!action.externalSideEffect) throw new Error("ResilientExternalExecutor only accepts external side-effect actions");
    if (!this.breaker.canExecute()) throw new Error("External execution circuit is open");

    try {
      const result = await this.executor.execute(action);
      this.breaker.success();
      return result;
    } catch (error) {
      this.breaker.failure();
      throw error;
    }
  }

  circuitState() {
    return this.breaker.snapshot();
  }
}
