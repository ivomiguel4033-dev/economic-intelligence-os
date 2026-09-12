import { NextRequest, NextResponse } from "next/server";
import { DecisionService } from "@/application/decision/decision-service";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import type { ModelProvider, ModelRequest, ModelResponse, ModelRouter } from "@/ai/model-provider";
import { resolveAuthenticatedContext } from "@/security/authenticated-context";
import { tryBeginTrackedWork } from "@/operations/drain-state";
import { declaredPayloadTooLarge, readBoundedPayload } from "@/http/bounded-request-body";

const MAX_DECISION_PAYLOAD_BYTES = 1_000_000;
const DECISION_PAYLOAD_TIMEOUT_MS = 5_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

class UnconfiguredProvider implements ModelProvider {
  readonly name = "unconfigured";
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    throw new Error("No production AI provider configured");
  }
}

const provider = new UnconfiguredProvider();
const router: ModelRouter = { route: () => provider };
const repository = new PostgresDecisionRepository();
const service = new DecisionService(repository, router);

function decisionError(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error },
    { status, headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}

export async function POST(request: NextRequest) {
  const releaseWork = tryBeginTrackedWork();
  if (!releaseWork) {
    return decisionError("Service is draining", 503, { "Retry-After": "1" });
  }

  try {
    if (declaredPayloadTooLarge(request, MAX_DECISION_PAYLOAD_BYTES)) {
      return decisionError("Decision request payload too large", 413);
    }

    const payload = await readBoundedPayload(request, MAX_DECISION_PAYLOAD_BYTES, DECISION_PAYLOAD_TIMEOUT_MS);
    if (payload.status === "too_large") {
      return decisionError("Decision request payload too large", 413);
    }
    if (payload.status === "timeout") {
      return decisionError("Decision request payload read timed out", 408);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payload.payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
      body = parsed as Record<string, unknown>;
    } catch {
      return decisionError("Invalid decision request", 400);
    }

    const context = await resolveAuthenticatedContext(
      request.headers.get("authorization"),
      typeof body.organizationId === "string" ? body.organizationId : undefined,
    );
    const decision = await service.create({
      organizationId: context.organizationId,
      title: String(body.title ?? ""),
      objective: String(body.objective ?? ""),
      context: String(body.context ?? ""),
    });
    return NextResponse.json(decision, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/OIDC verifier is not configured|No production AI provider configured/i.test(message)) {
      return decisionError("Decision service unavailable", 503, { "Retry-After": "1" });
    }
    if (/Bearer|authentication|Identity|token/i.test(message)) {
      return decisionError("Authentication required", 401, { "WWW-Authenticate": "Bearer" });
    }
    if (/membership|Organization access|Access denied/i.test(message)) {
      return decisionError("Access denied", 403);
    }
    if (/organizationId, title and objective are required/i.test(message)) {
      return decisionError("Invalid decision request", 400);
    }

    console.error("Decision request failed", error);
    return decisionError("Decision request failed", 500);
  } finally {
    releaseWork();
  }
}
