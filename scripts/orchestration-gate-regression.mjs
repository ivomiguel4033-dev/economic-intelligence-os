import assert from "node:assert/strict";
import { OrchestrationRuntime } from "../src/orchestration/runtime.ts";

const decision = { id: "decision-test", organizationId: "org-test" };
const board = {
  deliberate: async () => ({
    decisionId: decision.id,
    opinions: [],
    synthesis: "test",
    dissent: [],
    confidence: 0.95,
    generatedAt: new Date().toISOString(),
  }),
};
const runtime = new OrchestrationRuntime(board);
const action = {
  id: "action-test",
  organizationId: decision.organizationId,
  actionType: "analysis",
  reversible: true,
  externalSideEffect: false,
  riskTier: "medium",
  confidence: 0.9,
  evidenceCount: 1,
};
const evidence = [{ sourceId: "source-test", title: "Test source", authorityScore: 0.9 }];
const supported = [{ claim: "Supported claim", confidence: 0.9, status: "supported", evidence }];

const ready = await runtime.run(decision, supported, action);
assert.equal(ready.status, "ready-to-execute", "supported medium-risk decisions should remain eligible");

for (const [status, reason] of [
  ["insufficient", "lack sufficient evidence"],
  ["conflicted", "conflicting evidence"],
]) {
  const result = await runtime.run(decision, [{ ...supported[0], status }], action);
  assert.equal(result.status, "approval-required", `${status} claims must not be ready to execute`);
  assert.ok(result.gateReasons.some((item) => item.includes(reason)), `${status} gate reason must be preserved`);
}

const highImpact = await runtime.run(decision, supported, { ...action, riskTier: "high" });
assert.equal(highImpact.status, "approval-required", "high-impact decisions require approval");

const missingEvidence = await runtime.run(decision, supported, { ...action, evidenceCount: 0 });
assert.equal(missingEvidence.status, "approval-required", "execution policy must still require evidence");

console.log("Orchestration gate approval regression checks passed.");
