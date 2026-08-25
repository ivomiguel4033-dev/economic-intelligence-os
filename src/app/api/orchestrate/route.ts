import { NextRequest, NextResponse } from "next/server";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import { PostgresOrchestrationRepository } from "@/infrastructure/orchestration/postgres-orchestration-repository";
import { createOrchestrationRuntime } from "@/orchestration/runtime-factory";
import { enforceRuntimeBilling } from "@/billing/runtime-enforcement";
import { oidcVerifierFromEnvironment } from "@/security/oidc-verifier";
import { authenticateRequest } from "@/security/request-auth";
import { resolveVerifiedIdentity } from "@/security/identity-resolution";
import { resolveOrganizationForActor } from "@/security/organization-selection";
import { resolveAccessContext } from "@/security/access-context";
import { requireAuthorization } from "@/security/authorization-policy";
import type { SupportedClaim } from "@/trust/provenance";
import type { ProposedAction } from "@/execution/execution-policy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const verifier = oidcVerifierFromEnvironment();
    const verified = await authenticateRequest(request.headers.get("authorization"), verifier);
    const actor = await resolveVerifiedIdentity(verified);
    const organizationId = await resolveOrganizationForActor(actor.actorId, body.organizationId ? String(body.organizationId) : undefined);
    const access = await resolveAccessContext(actor.actorId, organizationId);
    requireAuthorization(access, { organizationId, resourceType: "decision" }, "execute");

    const decisionId = String(body.decisionId ?? "");
    if (!decisionId) throw new Error("decisionId is required");

    const decisions = new PostgresDecisionRepository();
    const decision = await decisions.findById(decisionId);
    if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    if (decision.organizationId !== organizationId) {
      return NextResponse.json({ error: "Cross-organization access denied" }, { status: 403 });
    }

    const claims = Array.isArray(body.claims) ? body.claims as SupportedClaim[] : [];
    const action: ProposedAction = {
      id: String(body.action?.id ?? crypto.randomUUID()),
      organizationId,
      actionType: String(body.action?.actionType ?? "analysis"),
      reversible: body.action?.reversible !== false,
      externalSideEffect: body.action?.externalSideEffect === true,
      riskTier: body.action?.riskTier ?? "low",
      confidence: Number(body.action?.confidence ?? 0.75),
      evidenceCount: Number(body.action?.evidenceCount ?? claims.reduce((sum, claim) => sum + claim.evidence.length, 0)),
    };

    await enforceRuntimeBilling(organizationId, "aiBoard");
    if (action.externalSideEffect) await enforceRuntimeBilling(organizationId, "autonomousExecution");

    const runtime = createOrchestrationRuntime();
    const result = await runtime.run(decision, claims, action);
    const runs = new PostgresOrchestrationRepository();
    const persisted = await runs.save(organizationId, result);

    return NextResponse.json({ ...result, runId: persisted.id, persistedAt: persisted.createdAt }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid orchestration request";
    const status = message.includes("No AI providers configured") || message.includes("OIDC verifier is not configured") ? 503
      : message.includes("authentication") || message.includes("Bearer") || message.includes("Identity") ? 401
      : message.includes("Access denied") || message.includes("membership") || message.includes("Organization access") ? 403
      : message.includes("subscription") || message.includes("plan") || message.includes("usage limit") || message.includes("Payment recovery") ? 402
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
