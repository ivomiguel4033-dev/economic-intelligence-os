import { db } from "@/infrastructure/database/postgres";
import type { IdempotencyStore } from "@/execution/idempotency";

export class PostgresIdempotencyStore<T> implements IdempotencyStore<T> {
  constructor(private readonly organizationId: string, private readonly actionId: string) {}

  async get(key: string): Promise<T | undefined> {
    const result = await db.query(
      `SELECT result FROM execution_idempotency
       WHERE idempotency_key=$1 AND organization_id=$2 LIMIT 1`,
      [key, this.organizationId],
    );
    return result.rows[0]?.result as T | undefined;
  }

  async putIfAbsent(key: string, value: T): Promise<boolean> {
    const result = await db.query(
      `INSERT INTO execution_idempotency (idempotency_key, organization_id, action_id, result)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, this.organizationId, this.actionId, JSON.stringify(value)],
    );
    return (result.rowCount ?? 0) === 1;
  }
}
