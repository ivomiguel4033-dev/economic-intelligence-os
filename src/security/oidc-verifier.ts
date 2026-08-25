import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IdentityVerifier, VerifiedIdentity } from "@/security/identity";

export interface OIDCVerifierConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
  providerName: string;
}

export class OIDCVerifier implements IdentityVerifier {
  private readonly jwks;

  constructor(private readonly config: OIDCVerifierConfig) {
    const jwksUrl = new URL(config.jwksUrl);
    if (jwksUrl.protocol !== "https:") throw new Error("OIDC JWKS URL must use HTTPS");
    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
    if (!payload.sub) throw new Error("OIDC subject missing");
    return {
      provider: this.config.providerName,
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      emailVerified: payload.email_verified === true,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }
}

export function oidcVerifierFromEnvironment(): OIDCVerifier {
  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;
  const jwksUrl = process.env.OIDC_JWKS_URL;
  const providerName = process.env.OIDC_PROVIDER_NAME ?? "oidc";
  if (!issuer || !audience || !jwksUrl) throw new Error("OIDC verifier is not configured");
  return new OIDCVerifier({ issuer, audience, jwksUrl, providerName });
}
