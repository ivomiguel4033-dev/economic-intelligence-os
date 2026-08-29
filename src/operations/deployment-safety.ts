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
  if (signals.acceptingNewWork) blockers.push("Service is still accepting new work");
  if (signals.inFlightExecutions > 0) blockers.push("Executions are still in flight");
  if (signals.claimedOutboxMessages > 0) blockers.push("Outbox messages are still claimed");
  return { safeToTerminate: blockers.length === 0, blockers };
}
