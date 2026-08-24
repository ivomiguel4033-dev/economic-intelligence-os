import type { ModelRouter } from "@/ai/model-provider";
import type { Decision } from "@/domain/decision/types";

export type BoardRole = "strategist" | "risk" | "finance" | "operator" | "critic";

export interface BoardOpinion {
  role: BoardRole;
  recommendation: string;
  reasoning: string;
  risks: string[];
  confidence: number;
}

export interface BoardVerdict {
  decisionId: string;
  opinions: BoardOpinion[];
  synthesis: string;
  dissent: string[];
  confidence: number;
  generatedAt: string;
}

const roles: BoardRole[] = ["strategist", "risk", "finance", "operator", "critic"];

export class AIBoard {
  constructor(private readonly models: ModelRouter) {}

  async deliberate(decision: Decision): Promise<BoardVerdict> {
    const opinions = await Promise.all(
      roles.map(async (role) => {
        const provider = this.models.route(role === "risk" ? "safety" : "reasoning");
        const response = await provider.generate({
          system: `Act as the ${role} member of an executive AI Board. Challenge assumptions. Return JSON with recommendation, reasoning, risks and confidence (0-1).`,
          prompt: JSON.stringify(decision),
          temperature: role === "critic" ? 0.4 : 0.2,
          metadata: { decisionId: decision.id, boardRole: role },
        });
        const parsed = JSON.parse(response.content) as Omit<BoardOpinion, "role">;
        return { role, ...parsed };
      }),
    );

    const chair = this.models.route("reasoning");
    const synthesisResponse = await chair.generate({
      system: "You chair an executive AI Board. Synthesize the independent opinions without hiding disagreement. Return JSON with synthesis, dissent (string array), confidence (0-1).",
      prompt: JSON.stringify({ decision, opinions }),
      temperature: 0.1,
      metadata: { decisionId: decision.id, boardRole: "chair" },
    });
    const synthesis = JSON.parse(synthesisResponse.content) as Pick<BoardVerdict, "synthesis" | "dissent" | "confidence">;

    return { decisionId: decision.id, opinions, ...synthesis, generatedAt: new Date().toISOString() };
  }
}
