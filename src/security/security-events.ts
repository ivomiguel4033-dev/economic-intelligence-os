import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

export interface SecurityEventInput {
  organizationId?: string;
  actorId?: string;
  eventType: string;
  severity?: "info" | "warning" | "high" | "critical";
  outcome: "allowed" | "denied" | "failed";
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

function digest(value?: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  await db.query(
    `INSERT INTO security_events (organization_id, actor_id, event_type, severity, outcome, ip_hash, user_agent_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.organizationId ?? null,
      input.actorId ?? null,
      input.eventType,
      input.severity ?? "info",
      input.outcome,
      digest(input.ip),
      digest(input.userAgent),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
