import { getClaimedOutboxCount } from "@/execution/transactional-outbox";
import { getInFlightWorkCount, isDraining } from "./drain-state";

export interface DeploymentSignals {
  readinessOk: boolean;
  ciGreen: boolean;
  migrationValidationOk: boolean;
  tenantIsolationOk: boolean;
  backupRestoreTested: boolean;
  criticalSecurityIncident: boolean;
}

export interface DeploymentDecision {
  allowed: boolean;
  blockers: string[];
}

export interface DrainSignals {
  acceptingNewWork: boolean;
  inFlightExecutions: number;
  claimedOutboxMessages: number;
}

export interface DrainDecision {
  safeToTerminate: boolean;
  blockers: string[];
}

export interface DrainWaitResult extends DrainDecision {
  timedOut: boolean;
  elapsedMs: number;
}

export function evaluateDeploymentSafety(signals: DeploymentSignals): DeploymentDecision {
  const blockers: string[] = [];
  if (!signals.ciGreen) blockers.push("CI is not green");
  if (!signals.migrationValidationOk) blockers.push("Database migrations are not validated");
  if (!signals.tenantIsolationOk) blockers.push("Tenant isolation checks failed");
  if (!signals.readinessOk) blockers.push("Service readiness failed");
  if (!signals.backupRestoreTested) blockers.push("Database restore has not been tested");
  if (signals.criticalSecurityIncident) blockers.push("Critical security incident is active");
  return { allowed: blockers.length === 0, blockers };
}

export function evaluateDrainSafety(signals: DrainSignals): DrainDecision {
  const blockers: string[] = [];

  // Drain counters are safety signals. Invalid telemetry must fail closed rather
  // than accidentally declaring an instance safe to terminate.
  if (!Number.isSafeInteger(signals.inFlightExecutions) || signals.inFlightExecutions < 0) {
    blockers.push("In-flight execution count is invalid");
  } else if (signals.inFlightExecutions > 0) {
    blockers.push("Executions are still in flight");
  }

  if (!Number.isSafeInteger(signals.claimedOutboxMessages) || signals.claimedOutboxMessages < 0) {
    blockers.push("Claimed outbox message count is invalid");
  } else if (signals.claimedOutboxMessages > 0) {
    blockers.push("Outbox messages are still claimed");
  }

  if (signals.acceptingNewWork) blockers.push("Service is still accepting new work");
  return { safeToTerminate: blockers.length === 0, blockers };
}

export function evaluateLocalDrainSafety(claimedOutboxMessages: number): DrainDecision {
  return evaluateDrainSafety({
    acceptingNewWork: !isDraining(),
    inFlightExecutions: getInFlightWorkCount(),
    claimedOutboxMessages,
  });
}

/**
 * Reads durable outbox ownership for this worker and combines it with the
 * process-local admission counter. Claims owned by other workers do not block
 * this instance from terminating.
 */
export async function evaluateWorkerDrainSafety(workerId: string): Promise<DrainDecision> {
  const claimedOutboxMessages = await getClaimedOutboxCount(workerId);
  return evaluateLocalDrainSafety(claimedOutboxMessages);
}

function boundedDrainOption(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

/**
 * Waits for an already-draining worker to become safe to terminate. The wait is
 * deliberately bounded so a broken dependency cannot hold shutdown forever.
 * Evaluation errors fail closed and are retried until the deadline.
 *
 * Keep timeoutMs below the platform's hard termination window so the caller
 * retains time for final logging/cleanup before SIGKILL. Invalid numeric
 * options fall back to safe defaults so NaN/Infinity cannot create an
 * unbounded or zero-delay shutdown loop.
 */
export async function waitForWorkerDrainSafety(
  workerId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<DrainWaitResult> {
  if (!workerId) throw new Error("Drain workerId is required");

  const timeoutMs = boundedDrainOption(options.timeoutMs, 25_000, 0, 25_000);
  const pollIntervalMs = boundedDrainOption(options.pollIntervalMs, 250, 25, 1_000);
  const startedAt = Date.now();
  let lastDecision: DrainDecision = {
    safeToTerminate: false,
    blockers: ["Drain safety has not been evaluated"],
  };

  while (true) {
    try {
      lastDecision = await evaluateWorkerDrainSafety(workerId);
      if (lastDecision.safeToTerminate) {
        return { ...lastDecision, timedOut: false, elapsedMs: Date.now() - startedAt };
      }
    } catch {
      lastDecision = {
        safeToTerminate: false,
        blockers: ["Drain safety evaluation failed"],
      };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return { ...lastDecision, safeToTerminate: false, timedOut: true, elapsedMs };
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - elapsedMs));
    });
  }
}
