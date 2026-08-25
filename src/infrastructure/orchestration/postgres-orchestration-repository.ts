import { db } from "@/infrastructure/database/postgres";
import type { OrchestrationResult } from "@/orchestration/runtime";

export class PostgresOrchestrationRepository {
  async save(organizationId: string, result: OrchestrationResult) {
    const saved = await db.query(
      `INSERT INTO orchestration_runs (
        organization_id, decision_id, phase, evidence_count, board_confidence, consensus_agreement, reasons
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [
        organizationId,
        result.decisionId,
        result.status,
        0,
        result.board.confidence,
        null,
        JSON.stringify([...result.gateReasons, ...result.executionReasons]),
      ],
    );
    return { id: String(saved.rows[0].id), createdAt: new Date(saved.rows[0].created_at).toISOString() };
  }
}
