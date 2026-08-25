import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationContext } from "@/security/organization-context";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import { PostgresOrchestrationRepository } from "@/infrastructure/orchestration/postgres-orchestration-repository";
import { createOrchestrationRuntime } from "@/orchestration/runtime-factory";
import type { SupportedClaim } from "@/trust/provenance";
import type { ProposedAction } from "@/execution/execution-policy";

export async function POST(request: NextRequest) {
  try {
    const context = requireOrganizationContext(request.headers);
    const body = await request.json();
    const decisionId = String(body.decisionId ?? "");
    if (!decisionId) throw new Error("decisionId is required");

    const decisions = new PostgresDecisionRepository();
    const decision = await decisions.findById(decisionId);
    if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    if (decision.organizationId !== context.organizationId) {
      return NextResponse.json({ error: "Cross-organization access denied" }, { status: 403 });
    }

    const claims = Array.isArray(body.claims) ? body.claims as SupportedClaim[] : [];
    const action: ProposedAction = {
      id: String(body.action?.id ?? crypto.randomUUID()),
      organizationId: context.organizationId,
      actionType: String(body.action?.actionType ?? "analysis"),
      reversible: body.action?.reversible !== false,
      externalSideEffect: body.action?.externalSideEffect === true,
      riskTier: body.action?.riskTier ?? "low",
      confidence: Number(body.action?.confidence ?? 0.75),
      evidenceCount: Number(body.action?.evidenceCount ?? claims.reduce((sum, claim) => sum + claim.evidence.length, 0)),
    };

    const runtime = createOrchestrationRuntime();
    const result = await runtime.run(decision, claims, action);
    const runs = new PostgresOrchestrationRepository();
    const persisted = await runs.save(context.organizationId, result);

    return NextResponse.json({ ...result, runId: persisted.id, persistedAt: persisted.createdAt }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid orchestration request";
    const status = message.includes("No AI providers configured") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
