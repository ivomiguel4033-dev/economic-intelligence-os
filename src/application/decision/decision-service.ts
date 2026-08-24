import type { DecisionRepository } from "@/domain/decision/repository";
import type { CreateDecisionInput, Decision, DecisionRecommendation } from "@/domain/decision/types";
import type { ModelRouter } from "@/ai/model-provider";

export class DecisionService {
  constructor(
    private readonly repository: DecisionRepository,
    private readonly models: ModelRouter,
  ) {}

  create(input: CreateDecisionInput): Promise<Decision> {
    if (!input.organizationId.trim() || !input.title.trim() || !input.objective.trim()) {
      throw new Error("organizationId, title and objective are required");
    }
    return this.repository.create(input);
  }

  async recommend(decisionId: string): Promise<DecisionRecommendation> {
    const decision = await this.repository.findById(decisionId);
    if (!decision) throw new Error("Decision not found");
    if (decision.options.length < 2) throw new Error("At least two options are required");

    const provider = this.models.route("reasoning");
    const response = await provider.generate({
      system: "You are the AI Board decision analyst. Compare options, expose risks and dissent, and recommend one option. Return concise JSON only.",
      prompt: JSON.stringify({
        objective: decision.objective,
        context: decision.context,
        options: decision.options,
        evidence: decision.evidence,
      }),
      temperature: 0.2,
      metadata: { decisionId },
    });

    const parsed = JSON.parse(response.content) as Pick<DecisionRecommendation, "recommendedOptionId" | "rationale" | "confidence" | "dissent">;
    if (!decision.options.some((option) => option.id === parsed.recommendedOptionId)) {
      throw new Error("Model returned an unknown option");
    }

    return {
      decisionId,
      ...parsed,
      generatedAt: new Date().toISOString(),
    };
  }
}
