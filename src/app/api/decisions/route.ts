import { NextRequest, NextResponse } from "next/server";
import { DecisionService } from "@/application/decision/decision-service";
import { InMemoryDecisionRepository } from "@/infrastructure/decision/in-memory-decision-repository";
import type { ModelProvider, ModelRequest, ModelResponse, ModelRouter } from "@/ai/model-provider";
import { requireOrganizationContext } from "@/security/organization-context";

class UnconfiguredProvider implements ModelProvider {
  readonly name = "unconfigured";
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    throw new Error("No production AI provider configured");
  }
}

const provider = new UnconfiguredProvider();
const router: ModelRouter = { route: () => provider };
const repository = new InMemoryDecisionRepository();
const service = new DecisionService(repository, router);

export async function POST(request: NextRequest) {
  try {
    const context = requireOrganizationContext(request.headers);
    const body = await request.json();
    const decision = await service.create({
      organizationId: context.organizationId,
      title: String(body.title ?? ""),
      objective: String(body.objective ?? ""),
      context: String(body.context ?? ""),
    });
    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }
}
