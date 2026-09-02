import { NextRequest, NextResponse } from "next/server";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import { PostgresOrchestrationRepository } from "@/infrastructure/orchestration/postgres-orchestration-repository";
import { getDatabasePoolSnapshot } from "@/infrastructure/database/postgres";
import { createOrchestrationRuntime } from "@/orchestration/runtime-factory";
import { enforceRuntimeBilling } from "@/billing/runtime-enforcement";
import { resolveAuthenticatedContext } from "@/security/authenticated-context";
import { requireAuthorization } from "@/security/authorization-policy";
import { requireRecentAuthentication, requireStepUp } from "@/security/step-up-auth";
import { tryBeginTrackedWork } from "@/operations/drain-state";
import { tryAcquireTenantConcurrency } from "@/operations/tenant-concurrency";
import type { SupportedClaim } from "@/trust/provenance";
import type { ProposedAction } from "@/execution/execution-policy";

export async function POST(request: NextRequest) {
  const releaseWork = tryBeginTrackedWork();
  if (!releaseWork) {
    return NextResponse.json(
      { error: "Service is draining" },
      { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } },
    );
  }

  let releaseTenantConcurrency: (() => void) | null = null;

  try {
    const pool = getDatabasePoolSnapshot();
    if (pool.waiting > 0 || (pool.total >= pool.max && pool.idle === 0)) {
      return NextResponse.json(
        { error: "Service temporarily overloaded", reason: "database_pool_saturated" },
        { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } },
      );
    }

    const body = await request.json();
    const access = await resolveAuthenticatedContext(
      request.headers.get("authorization"),
      body.organizationId ? String(body.organizationId) : undefined,
    );
    const organizationId = access.organizationId;
    requireAuthorization(access, { organizationId, resourceType: "decision" }, "execute");

    releaseTenantConcurrency = tryAcquireTenantConcurrency(organizationId);
    if (!releaseTenantConcurrency) {
      return NextResponse.json(
        { error: "Tenant orchestration concurrency limit reached", reason: "tenant_concurrency_limited" },
        { status: 429, headers: { "Retry-After": "1", "Cache-Control": "no-store" } },
      );
    }

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

    if (action.externalSideEffect) {
      requireStepUp(access, action.riskTier === "high" || action.riskTier === "critical" ? "phishing-resistant" : "mfa");
      requireRecentAuthentication(access, 600);
    }

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
      : message.includes("authentication") || message.includes("Bearer") || message.includes("Identity") || message.includes("token") ? 401
      : message.includes("Step-up") || message.includes("Recent authentication") ? 401
      : message.includes("Access denied") || message.includes("membership") || message.includes("Organization access") ? 403
      : message.includes("subscription") || message.includes("plan") || message.includes("usage limit") || message.includes("Payment recovery") ? 402
      : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    releaseTenantConcurrency?.();
    releaseWork();
  }
}
