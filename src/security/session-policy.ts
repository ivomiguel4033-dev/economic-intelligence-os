export interface SessionState {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  assurance: "password" | "mfa" | "phishing-resistant";
}

export function assertActiveSession(session: SessionState, now = new Date()): void {
  if (session.revokedAt) throw new Error("Session revoked");
  if (session.expiresAt.getTime() <= now.getTime()) throw new Error("Session expired");
  const idleMs = now.getTime() - session.lastSeenAt.getTime();
  if (idleMs > 12 * 60 * 60 * 1000) throw new Error("Session idle timeout exceeded");
}

export function requiresRecentAuthentication(session: SessionState, maxAgeMinutes = 10, now = new Date()): boolean {
  return now.getTime() - session.createdAt.getTime() > maxAgeMinutes * 60_000;
}
