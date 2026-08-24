import type { CreateDecisionInput, Decision } from "./types";

export interface DecisionRepository {
  create(input: CreateDecisionInput): Promise<Decision>;
  findById(id: string): Promise<Decision | null>;
  listByOrganization(organizationId: string): Promise<Decision[]>;
  save(decision: Decision): Promise<Decision>;
}
