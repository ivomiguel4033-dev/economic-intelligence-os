import type { IdentityVerifier, VerifiedIdentity } from "@/security/identity";

export function bearerToken(authorization: string | null): string {
  if (!authorization?.startsWith("Bearer ")) throw new Error("Bearer authentication required");
  const token = authorization.slice(7).trim();
  if (!token) throw new Error("Bearer token missing");
  return token;
}

export async function authenticateRequest(authorization: string | null, verifier: IdentityVerifier): Promise<VerifiedIdentity> {
  const identity = await verifier.verify(bearerToken(authorization));
  if (!identity.subject || !identity.provider) throw new Error("Verified identity is incomplete");
  return identity;
}
