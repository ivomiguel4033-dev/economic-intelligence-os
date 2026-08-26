import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

export class ExecutionLease {
  readonly ownerId = randomUUID();

  constructor(private readonly organizationId: string) {
    if (!organizationId) throw new Error("ExecutionLease requires organizationId");
  }

  async acquire(leaseKey: string, ttlSeconds = 60): Promise<boolean> {
    const ttl = Math.max(5, Math.min(ttlSeconds, 3600));
    const result = await db.query(
      `INSERT INTO execution_leases (organization_id, lease_key, owner_id, expires_at)
       VALUES ($1,$2,$3,NOW() + ($4 * INTERVAL '1 second'))
       ON CONFLICT (organization_id, lease_key) DO UPDATE
       SET owner_id=EXCLUDED.owner_id, acquired_at=NOW(), expires_at=EXCLUDED.expires_at
       WHERE execution_leases.expires_at <= NOW()
       RETURNING owner_id`,
      [this.organizationId, leaseKey, this.ownerId, ttl],
    );
    return result.rows[0]?.owner_id === this.ownerId;
  }

  async renew(leaseKey: string, ttlSeconds = 60): Promise<boolean> {
    const ttl = Math.max(5, Math.min(ttlSeconds, 3600));
    const result = await db.query(
      `UPDATE execution_leases SET expires_at=NOW() + ($4 * INTERVAL '1 second')
       WHERE organization_id=$1 AND lease_key=$2 AND owner_id=$3 AND expires_at > NOW()
       RETURNING lease_key`,
      [this.organizationId, leaseKey, this.ownerId, ttl],
    );
    return result.rowCount === 1;
  }

  async release(leaseKey: string): Promise<void> {
    await db.query(
      `DELETE FROM execution_leases WHERE organization_id=$1 AND lease_key=$2 AND owner_id=$3`,
      [this.organizationId, leaseKey, this.ownerId],
    );
  }
}
