import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

function digest(value?: string | null): string | null {
  if (!value) return null;
  const pepper = process.env.SECURITY_EVENT_HASH_PEPPER;
  if (!pepper) throw new Error("SECURITY_EVENT_HASH_PEPPER is not configured");
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export async function recordSecurityEvent(input: {
  eventType: string;
  outcome: "allowed" | "denied" | "failed";
  severity?: "info" | "warning" | "high" | "critical";
  actorId?: string;
  organizationId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO security_events
      (event_type, severity, outcome, actor_id, organization_id, ip_hash, user_agent_hash, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())`,
    [
      input.eventType,
      input.severity ?? "info",
      input.outcome,
      input.actorId ?? null,
      input.organizationId ?? null,
      digest(input.ip),
      digest(input.userAgent),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
