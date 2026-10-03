export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  event: string;
  requestId?: string;
  organizationId?: string;
  actorId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export function log(level: LogLevel, input: LogEvent): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: "economic-intelligence-os",
    ...input,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
