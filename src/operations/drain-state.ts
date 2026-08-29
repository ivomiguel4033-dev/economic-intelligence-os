let draining = false;

/**
 * Process-local admission state used during graceful instance retirement.
 * Once draining begins the instance must stop advertising readiness before
 * waiting for already-admitted work to finish.
 */
export function beginDrain(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}
