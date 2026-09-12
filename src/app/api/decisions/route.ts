import { NextRequest, NextResponse } from "next/server";
import { DecisionService } from "@/application/decision/decision-service";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import type { ModelProvider, ModelRequest, ModelResponse, ModelRouter } from "@/ai/model-provider";
import { resolveAuthenticatedContext } from "@/security/authenticated-context";
import { tryBeginTrackedWork } from "@/operations/drain-state";
import { declaredPayloadTooLarge, readBoundedPayload } from "@/http/bounded-request-body";

const MAX_DECISION_PAYLOAD_BYTES = 1_000_000;
const DECISION_PAYLOAD_TIMEOUT_MS = 5_000;

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

export async function POST(request: NextRequest) {
  const releaseWork = tryBeginTrackedWork();
  if (!releaseWork) {
    return NextResponse.json(
      { error: "Service is draining" },
      { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } },
    );
  }

  try {
    if (declaredPayloadTooLarge(request, MAX_DECISION_PAYLOAD_BYTES)) {
      return NextResponse.json(
        { error: "Decision request payload too large" },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payload = await readBoundedPayload(request, MAX_DECISION_PAYLOAD_BYTES, DECISION_PAYLOAD_TIMEOUT_MS);
    if (payload.status === "too_large") {
      return NextResponse.json(
        { error: "Decision request payload too large" },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (payload.status === "timeout") {
      return NextResponse.json(
        { error: "Decision request payload read timed out" },
        { status: 408, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = JSON.parse(payload.payload) as Record<string, unknown>;
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
    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = /Bearer|Identity|OIDC|token|membership|Organization access/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    releaseWork();
  }
}
