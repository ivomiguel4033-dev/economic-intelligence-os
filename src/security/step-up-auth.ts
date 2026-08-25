export type AuthAssurance = "password" | "mfa" | "phishing-resistant";

export interface AuthenticatedSession {
  actorId: string;
  organizationId: string;
  assurance: AuthAssurance;
  authenticatedAt: string;
}

export function requireStepUp(session: AuthenticatedSession, minimum: AuthAssurance): void {
  const rank: Record<AuthAssurance, number> = { password: 1, mfa: 2, "phishing-resistant": 3 };
  if (rank[session.assurance] < rank[minimum]) throw new Error(`Step-up authentication required: ${minimum}`);
}

export function requireRecentAuthentication(session: AuthenticatedSession, maxAgeSeconds = 600): void {
  const age = (Date.now() - new Date(session.authenticatedAt).getTime()) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds) throw new Error("Recent authentication required");
}
