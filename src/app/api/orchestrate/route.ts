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
import { tryAcquireDistributedTenantConcurrency, type DistributedTenantConcurrencyLease } from "@/operations/distributed-tenant-concurrency";
import { declaredPayloadTooLarge, readBoundedPayload } from "@/http/bounded-request-body";
import type { SupportedClaim } from "@/trust/provenance";
import type { ProposedAction } from "@/execution/execution-policy";

const TENANT_CONCURRENCY_HEARTBEAT_MS = 30_000;
const MAX_ORCHESTRATION_REQUEST_BYTES = 1_000_000;
const ORCHESTRATION_REQUEST_READ_TIMEOUT_MS = 15_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function orchestrationError(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error },
    { status, headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}

export async function POST(request: NextRequest) {
  const releaseWork = tryBeginTrackedWork();
  if (!releaseWork) {
    return orchestrationError("Service is draining", 503, { "Retry-After": "1" });
  }

  let tenantConcurrencyLease: DistributedTenantConcurrencyLease | null = null;
  let tenantConcurrencyHeartbeat: ReturnType<typeof setInterval> | null = null;
  let tenantConcurrencyRenewal: Promise<void> | null = null;
  let tenantConcurrencyLeaseLost = false;

  try {
    const pool = getDatabasePoolSnapshot();
    if (pool.waiting > 0 || (pool.total >= pool.max && pool.idle === 0)) {
      return NextResponse.json(
        { error: "Service temporarily overloaded", reason: "database_pool_saturated" },
        { status: 503, headers: { "Retry-After": "1", ...NO_STORE_HEADERS } },
      );
    }

    if (declaredPayloadTooLarge(request, MAX_ORCHESTRATION_REQUEST_BYTES)) {
      return orchestrationError("Orchestration request payload too large", 413);
    }

    const payload = await readBoundedPayload(
      request,
      MAX_ORCHESTRATION_REQUEST_BYTES,
      ORCHESTRATION_REQUEST_READ_TIMEOUT_MS,
    );
    if (payload.status === "too_large") {
      return orchestrationError("Orchestration request payload too large", 413);
    }
    if (payload.status === "timeout") {
      return orchestrationError("Orchestration request payload read timed out", 408);
    }

    let body: Record<string, any>;
    try {
      const parsed = JSON.parse(payload.payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
      body = parsed as Record<string, any>;
    } catch {
      return orchestrationError("Invalid orchestration request", 400);
    }

    const access = await resolveAuthenticatedContext(
      request.headers.get("authorization"),
      body.organizationId ? String(body.organizationId) : undefined,
    );
    const organizationId = access.organizationId;
    requireAuthorization(access, { organizationId, resourceType: "decision" }, "execute");

    tenantConcurrencyLease = await tryAcquireDistributedTenantConcurrency(organizationId);
    if (!tenantConcurrencyLease) {
      return NextResponse.json(
        { error: "Tenant orchestration concurrency limit reached", reason: "tenant_concurrency_limited" },
        { status: 429, headers: { "Retry-After": "1", ...NO_STORE_HEADERS } },
      );
    }

    const renewTenantConcurrencyLease = () => {
      if (!tenantConcurrencyLease || tenantConcurrencyRenewal || tenantConcurrencyLeaseLost) return;
      tenantConcurrencyRenewal = tenantConcurrencyLease.renew()
        .then((renewed) => {
          if (!renewed) tenantConcurrencyLeaseLost = true;
        })
        .catch((error) => {
          tenantConcurrencyLeaseLost = true;
          console.error("Failed to renew distributed tenant concurrency lease", error);
        })
        .finally(() => {
          tenantConcurrencyRenewal = null;
        });
    };

    tenantConcurrencyHeartbeat = setInterval(renewTenantConcurrencyLease, TENANT_CONCURRENCY_HEARTBEAT_MS);
    tenantConcurrencyHeartbeat.unref?.();

    const decisionId = String(body.decisionId ?? "");
    if (!decisionId) throw new Error("decisionId is required");

    const decisions = new PostgresDecisionRepository();
    const decision = await decisions.findById(decisionId);
    if (!decision) return orchestrationError("Decision not found", 404);
    if (decision.organizationId !== organizationId) {
      return orchestrationError("Access denied", 403);
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

    if (tenantConcurrencyRenewal) await tenantConcurrencyRenewal;
    if (tenantConcurrencyLeaseLost || !(await tenantConcurrencyLease.renew())) {
      throw new Error("Tenant concurrency lease lost during orchestration");
    }

    const runs = new PostgresOrchestrationRepository();
    const persisted = await runs.save(organizationId, result);

    return NextResponse.json(
      { ...result, runId: persisted.id, persistedAt: persisted.createdAt },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/No AI providers configured|OIDC verifier is not configured|Tenant concurrency lease lost/i.test(message)) {
      return orchestrationError("Orchestration service unavailable", 503, { "Retry-After": "1" });
    }
    if (/authentication|Bearer|Identity|token|Step-up|Recent authentication/i.test(message)) {
      return orchestrationError("Authentication required", 401, { "WWW-Authenticate": "Bearer" });
    }
    if (/Access denied|membership|Organization access/i.test(message)) {
      return orchestrationError("Access denied", 403);
    }
    if (/subscription|plan|usage limit|Payment recovery/i.test(message)) {
      return orchestrationError("Billing entitlement required", 402);
    }
    if (/decisionId is required/i.test(message)) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    console.error("Orchestration request failed", error);
    return orchestrationError("Orchestration request failed", 500);
  } finally {
    if (tenantConcurrencyHeartbeat) clearInterval(tenantConcurrencyHeartbeat);
    if (tenantConcurrencyRenewal) await tenantConcurrencyRenewal;
    try {
      await tenantConcurrencyLease?.release();
    } catch (error) {
      console.error("Failed to release distributed tenant concurrency lease", error);
    } finally {
      releaseWork();
    }
  }
}
