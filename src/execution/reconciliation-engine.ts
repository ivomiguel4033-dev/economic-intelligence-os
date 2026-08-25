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
  const lease = new ExecutionLease();
  let resolved = 0;
  let remaining = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const leaseKey = `reconcile:${candidate.runId}`;
    if (!(await lease.acquire(leaseKey, 60))) {
      skipped += 1;
      continue;
    }
    try {
      const result = await provider.reconcile(candidate);
      if (result.status === "confirmed_succeeded") {
        await transitionExecution(candidate.runId, "succeeded", { result: result.result });
        resolved += 1;
      } else if (result.status === "confirmed_failed") {
        await transitionExecution(candidate.runId, "failed", { uncertaintyReason: result.reason });
        resolved += 1;
      } else {
        await transitionExecution(candidate.runId, "uncertain", { uncertaintyReason: result.reason ?? candidate.uncertaintyReason });
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
