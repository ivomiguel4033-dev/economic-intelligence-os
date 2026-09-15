import type { ReconciliationResult } from "@/execution/reconciliation-engine";

export interface ReexecutionDecision {
  mayReexecute: boolean;
  reason: string;
}

export function evaluateReexecution<T>(result: ReconciliationResult<T>): ReexecutionDecision {
  if (result.status === "confirmed_succeeded") return { mayReexecute: false, reason: "Provider confirms the original action succeeded" };
  if (result.status === "still_uncertain") return { mayReexecute: false, reason: "Outcome remains uncertain; blind replay is forbidden" };
  return { mayReexecute: true, reason: "Provider confirms the original action failed" };
}
