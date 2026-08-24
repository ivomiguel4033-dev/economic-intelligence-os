import type { DecisionRepository } from "@/domain/decision/repository";
import type { CreateDecisionInput, Decision } from "@/domain/decision/types";
import { db } from "@/infrastructure/database/postgres";

function mapDecision(row: Record<string, unknown>): Decision {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    title: String(row.title),
    objective: String(row.objective),
    context: String(row.context ?? ""),
    status: row.status as Decision["status"],
    options: (row.options ?? []) as Decision["options"],
    evidence: (row.evidence ?? []) as Decision["evidence"],
    selectedOptionId: row.selected_option_id ? String(row.selected_option_id) : undefined,
    rationale: row.rationale ? String(row.rationale) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PostgresDecisionRepository implements DecisionRepository {
  async create(input: CreateDecisionInput): Promise<Decision> {
    const result = await db.query(
      `INSERT INTO decisions (organization_id, title, objective, context)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.organizationId, input.title, input.objective, input.context ?? ""],
    );
    return mapDecision(result.rows[0]);
  }

  async findById(id: string): Promise<Decision | null> {
    const result = await db.query("SELECT * FROM decisions WHERE id = $1", [id]);
    return result.rows[0] ? mapDecision(result.rows[0]) : null;
  }

  async listByOrganization(organizationId: string): Promise<Decision[]> {
    const result = await db.query(
      "SELECT * FROM decisions WHERE organization_id = $1 ORDER BY updated_at DESC",
      [organizationId],
    );
    return result.rows.map(mapDecision);
  }

  async save(decision: Decision): Promise<Decision> {
    const result = await db.query(
      `UPDATE decisions SET title=$2, objective=$3, context=$4, status=$5, options=$6,
       evidence=$7, selected_option_id=$8, rationale=$9, updated_at=now()
       WHERE id=$1 AND organization_id=$10 RETURNING *`,
      [decision.id, decision.title, decision.objective, decision.context, decision.status,
       JSON.stringify(decision.options), JSON.stringify(decision.evidence), decision.selectedOptionId ?? null,
       decision.rationale ?? null, decision.organizationId],
    );
    if (!result.rows[0]) throw new Error("Decision not found or organization mismatch");
    return mapDecision(result.rows[0]);
  }
}
