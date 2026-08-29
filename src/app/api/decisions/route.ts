import { NextRequest, NextResponse } from "next/server";
import { DecisionService } from "@/application/decision/decision-service";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";
import type { ModelProvider, ModelRequest, ModelResponse, ModelRouter } from "@/ai/model-provider";
import { resolveAuthenticatedContext } from "@/security/authenticated-context";
import { isDraining } from "@/operations/drain-state";

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
  if (isDraining()) {
    return NextResponse.json(
      { error: "Service is draining" },
      { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } },
    );
  }

  try {
    const body = await request.json();
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
  }
}
