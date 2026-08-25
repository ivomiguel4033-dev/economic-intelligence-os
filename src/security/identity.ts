import type { AuthAssurance } from "@/security/step-up-auth";

export interface VerifiedIdentity {
  provider: string;
  subject: string;
  email?: string;
  emailVerified: boolean;
  issuedAt?: number;
  expiresAt?: number;
  authTime?: number;
  assurance: AuthAssurance;
}

export interface IdentityVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

export function assertIdentityFresh(identity: VerifiedIdentity, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (identity.expiresAt && identity.expiresAt <= nowSeconds) throw new Error("Identity token expired");
  if (identity.issuedAt && identity.issuedAt > nowSeconds + 60) throw new Error("Identity token issued in the future");
  if (identity.authTime && identity.authTime > nowSeconds + 60) throw new Error("Authentication time is in the future");
}
