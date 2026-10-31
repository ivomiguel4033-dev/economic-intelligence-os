import type { IdentityVerifier, VerifiedIdentity } from "@/security/identity";

export function bearerToken(authorization: string | null): string {
  if (!authorization?.startsWith("Bearer ")) throw new Error("Bearer authentication required");
  const token = authorization.slice(7);
  if (!token) throw new Error("Bearer token missing");
  // RFC 6750 b64token grammar: reject whitespace, delimiters and control
  // characters rather than silently normalizing an untrusted credential.
  if (token.length > 8_192 || !/^[A-Za-z0-9._~+/-]+={0,2}$/.test(token)) {
    throw new Error("Invalid bearer token");
  }
  return token;
}

export async function authenticateRequest(authorization: string | null, verifier: IdentityVerifier): Promise<VerifiedIdentity> {
  const identity = await verifier.verify(bearerToken(authorization));
  if (!identity.subject || !identity.provider) throw new Error("Verified identity is incomplete");
  return identity;
}
