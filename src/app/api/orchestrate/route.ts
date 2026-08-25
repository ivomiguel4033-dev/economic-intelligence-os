import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationContext } from "@/security/organization-context";
import { PostgresDecisionRepository } from "@/infrastructure/decision/postgres-decision-repository";

export async function POST(request: NextRequest) {
  try {
    const context = requireOrganizationContext(request.headers);
    const body = await request.json();
    const decisionId = String(body.decisionId ?? "");
    if (!decisionId) throw new Error("decisionId is required");

    const repository = new PostgresDecisionRepository();
    const decision = await repository.findById(decisionId);
    if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    if (decision.organizationId !== context.organizationId) {
      return NextResponse.json({ error: "Cross-organization access denied" }, { status: 403 });
    }

    return NextResponse.json(
      {
        status: "accepted",
        decisionId,
        message: "Decision validated for orchestration runtime. Provider-backed execution is enabled once production model adapters are configured.",
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid orchestration request" },
      { status: 400 },
    );
  }
}
