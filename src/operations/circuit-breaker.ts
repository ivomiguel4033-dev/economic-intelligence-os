export interface CircuitBreakerState {
  failures: number;
  openedAt?: number;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = { failures: 0 };

  constructor(private readonly failureThreshold = 5, private readonly resetAfterMs = 60_000) {
    assertPositiveSafeInteger(failureThreshold, "failureThreshold");
    assertPositiveSafeInteger(resetAfterMs, "resetAfterMs");
  }

  canExecute(now = Date.now()): boolean {
    if (!Number.isFinite(now)) {
      throw new Error("now must be finite");
    }
    if (this.state.openedAt === undefined) return true;
    if (now - this.state.openedAt >= this.resetAfterMs) {
      this.state = { failures: 0 };
      return true;
    }
    return false;
  }

  success(): void {
    this.state = { failures: 0 };
  }

  failure(now = Date.now()): void {
    if (!Number.isFinite(now)) {
      throw new Error("now must be finite");
    }
    const failures = this.state.failures + 1;
    this.state = { failures, openedAt: failures >= this.failureThreshold ? now : undefined };
  }

  snapshot(): Readonly<CircuitBreakerState> {
    return { ...this.state };
  }
}
