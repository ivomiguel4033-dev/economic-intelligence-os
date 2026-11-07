import { listUncertainExecutions, type ReconciliationCandidate } from "@/execution/reconciliation";
import { transitionExecution } from "@/execution/execution-state";
import { ExecutionLease } from "@/execution/execution-lease";
import { log } from "@/observability/structured-log";

export type ReconciliationResult<T> =
  | { status: "confirmed_succeeded"; result: T }
  | { status: "confirmed_failed"; reason?: string }
  | { status: "still_uncertain"; reason?: string };

export interface ReconciliationProvider<T> {
  reconcile(candidate: ReconciliationCandidate): Promise<ReconciliationResult<T>>;
}

export async function reconcileUncertainExecutions<T>(provider: ReconciliationProvider<T>, limit = 100): Promise<{ checked: number; resolved: number; remaining: number; skipped: number }> {
  const candidates = await listUncertainExecutions(limit);
  let resolved = 0;
  let remaining = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const lease = new ExecutionLease(candidate.organizationId);
    const leaseKey = `reconcile:${candidate.runId}`;
    const fence = await lease.acquireWithFence(leaseKey, 60);
    if (!fence) {
      skipped += 1;
      continue;
    }
    const leaseGuard = { leaseKey, ownerId: fence.ownerId, fencingToken: fence.fencingToken };
    try {
      const result = await provider.reconcile(candidate);
      if (result.status === "confirmed_succeeded") {
        await transitionExecution(candidate.organizationId, candidate.runId, "uncertain", "succeeded", { result: result.result, leaseGuard });
        resolved += 1;
      } else if (result.status === "confirmed_failed") {
        await transitionExecution(candidate.organizationId, candidate.runId, "uncertain", "failed", { uncertaintyReason: result.reason, leaseGuard });
        resolved += 1;
      } else {
        await transitionExecution(candidate.organizationId, candidate.runId, "uncertain", "uncertain", { uncertaintyReason: result.reason ?? candidate.uncertaintyReason, leaseGuard });
        remaining += 1;
      }
    } catch (error) {
      remaining += 1;
      log("warn", {
        event: "execution_reconciliation_failed",
        organizationId: candidate.organizationId,
        metadata: { runId: candidate.runId, actionId: candidate.actionId, message: error instanceof Error ? error.message : "unknown error" },
      });
    } finally {
      await lease.release(leaseKey);
    }
  }

  return { checked: candidates.length, resolved, remaining, skipped };
}
