let draining = false;
let inFlightWork = 0;

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

/**
 * Atomically admits and tracks one unit of request work with respect to the
 * process-local drain flag. JavaScript executes this synchronous critical
 * section without interleaving signal callbacks, so beginDrain cannot slip
 * between the admission check and counter increment.
 *
 * The returned release function is idempotent so error paths and defensive
 * cleanup cannot underflow the counter.
 */
export function tryBeginTrackedWork(): (() => void) | null {
  if (draining) return null;

  inFlightWork += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    inFlightWork -= 1;
  };
}

export function getInFlightWorkCount(): number {
  return inFlightWork;
}
