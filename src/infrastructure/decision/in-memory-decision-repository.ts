import type { DecisionRepository } from "@/domain/decision/repository";
import type { CreateDecisionInput, Decision } from "@/domain/decision/types";

export class InMemoryDecisionRepository implements DecisionRepository {
  private readonly decisions = new Map<string, Decision>();

  async create(input: CreateDecisionInput): Promise<Decision> {
    const now = new Date().toISOString();
    const decision: Decision = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      title: input.title,
      objective: input.objective,
      context: input.context ?? "",
      status: "draft",
      options: [],
      evidence: [],
      createdAt: now,
      updatedAt: now,
    };
    this.decisions.set(decision.id, decision);
    return decision;
  }

  async findById(id: string): Promise<Decision | null> {
    return this.decisions.get(id) ?? null;
  }

  async listByOrganization(organizationId: string): Promise<Decision[]> {
    return [...this.decisions.values()].filter((item) => item.organizationId === organizationId);
  }

  async save(decision: Decision): Promise<Decision> {
    const updated = { ...decision, updatedAt: new Date().toISOString() };
    this.decisions.set(updated.id, updated);
    return updated;
  }
}
