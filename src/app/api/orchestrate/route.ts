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
const MAX_ORCHESTRATION_CLAIMS = 256;
const MAX_EVIDENCE_PER_CLAIM = 256;
const MAX_IDENTIFIER_CHARS = 256;
const MAX_ACTION_TYPE_CHARS = 128;
const MAX_CLAIM_CHARS = 16_000;
const MAX_EVIDENCE_SOURCE_ID_CHARS = 512;
const MAX_EVIDENCE_TITLE_CHARS = 4_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u0080-\u009f]/;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function orchestrationError(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error },
    { status, headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}

function hasJsonMediaType(request: NextRequest): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
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

    const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      return orchestrationError("Unsupported content encoding", 415);
    }

    if (!hasJsonMediaType(request)) {
      return orchestrationError("Unsupported media type", 415);
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

    if (body.organizationId !== undefined && (typeof body.organizationId !== "string" || !body.organizationId.trim() || body.organizationId !== body.organizationId.trim() || CONTROL_CHARACTERS.test(body.organizationId) || body.organizationId.length > MAX_IDENTIFIER_CHARS)) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    if (typeof body.decisionId !== "string" || !body.decisionId.trim() || body.decisionId !== body.decisionId.trim() || CONTROL_CHARACTERS.test(body.decisionId) || body.decisionId.length > MAX_IDENTIFIER_CHARS) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    if (body.action !== undefined && (!body.action || typeof body.action !== "object" || Array.isArray(body.action))) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    const requestedAction = body.action as Record<string, unknown> | undefined;
    if (
      requestedAction
      && (
        (requestedAction.id !== undefined && (typeof requestedAction.id !== "string" || !requestedAction.id.trim() || requestedAction.id !== requestedAction.id.trim() || CONTROL_CHARACTERS.test(requestedAction.id) || requestedAction.id.length > MAX_IDENTIFIER_CHARS))
        || (requestedAction.actionType !== undefined && (typeof requestedAction.actionType !== "string" || !requestedAction.actionType.trim() || requestedAction.actionType !== requestedAction.actionType.trim() || CONTROL_CHARACTERS.test(requestedAction.actionType) || requestedAction.actionType.length > MAX_ACTION_TYPE_CHARS))
        || (requestedAction.reversible !== undefined && typeof requestedAction.reversible !== "boolean")
        || (requestedAction.externalSideEffect !== undefined && typeof requestedAction.externalSideEffect !== "boolean")
        || (requestedAction.riskTier !== undefined && (typeof requestedAction.riskTier !== "string" || !["low", "medium", "high", "critical"].includes(requestedAction.riskTier)))
        || (requestedAction.confidence !== undefined && (typeof requestedAction.confidence !== "number" || !Number.isFinite(requestedAction.confidence) || requestedAction.confidence < 0 || requestedAction.confidence > 1))
        || (requestedAction.evidenceCount !== undefined && (typeof requestedAction.evidenceCount !== "number" || !Number.isSafeInteger(requestedAction.evidenceCount) || requestedAction.evidenceCount < 0))
      )
    ) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    if (
      body.claims !== undefined
      && (
        !Array.isArray(body.claims)
        || body.claims.length > MAX_ORCHESTRATION_CLAIMS
        || body.claims.some((claim: unknown) => {
          if (!claim || typeof claim !== "object" || Array.isArray(claim)) return true;
          const candidate = claim as Record<string, unknown>;
          if (
            typeof candidate.claim !== "string"
            || !candidate.claim.trim()
            || candidate.claim.length > MAX_CLAIM_CHARS
            || typeof candidate.confidence !== "number"
            || !Number.isFinite(candidate.confidence)
            || candidate.confidence < 0
            || candidate.confidence > 1
            || !["supported", "conflicted", "insufficient"].includes(candidate.status as string)
            || !Array.isArray(candidate.evidence)
            || candidate.evidence.length > MAX_EVIDENCE_PER_CLAIM
          ) return true;
          return candidate.evidence.some((evidence: unknown) => {
            if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return true;
            const reference = evidence as Record<string, unknown>;
            return typeof reference.sourceId !== "string"
              || !reference.sourceId.trim()
              || reference.sourceId !== reference.sourceId.trim()
              || CONTROL_CHARACTERS.test(reference.sourceId)
              || reference.sourceId.length > MAX_EVIDENCE_SOURCE_ID_CHARS
              || typeof reference.title !== "string"
              || !reference.title.trim()
              || reference.title.length > MAX_EVIDENCE_TITLE_CHARS
              || (reference.authorityScore !== undefined
                && (typeof reference.authorityScore !== "number"
                  || !Number.isFinite(reference.authorityScore)
                  || reference.authorityScore < 0
                  || reference.authorityScore > 1));
          });
        })
      )
    ) {
      return orchestrationError("Invalid orchestration request", 400);
    }

    const access = await resolveAuthenticatedContext(
      request.headers.get("authorization"),
      body.organizationId as string | undefined,
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

    const decisionId = body.decisionId;

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
