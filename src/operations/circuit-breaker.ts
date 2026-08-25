export interface CircuitBreakerState {
  failures: number;
  openedAt?: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = { failures: 0 };

  constructor(private readonly failureThreshold = 5, private readonly resetAfterMs = 60_000) {}

  canExecute(now = Date.now()): boolean {
    if (!this.state.openedAt) return true;
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
    const failures = this.state.failures + 1;
    this.state = { failures, openedAt: failures >= this.failureThreshold ? now : undefined };
  }

  snapshot(): Readonly<CircuitBreakerState> {
    return { ...this.state };
  }
}
