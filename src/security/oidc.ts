export interface OidcClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  acr?: string;
  amr?: string[];
}

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email?: string;
  emailVerified: boolean;
  assurance: "password" | "mfa" | "phishing-resistant";
}

export interface OidcVerifier {
  verifyBearerToken(token: string): Promise<OidcClaims>;
}

function assuranceFromClaims(claims: OidcClaims): VerifiedIdentity["assurance"] {
  const methods = new Set(claims.amr ?? []);
  if (methods.has("webauthn") || methods.has("hwk")) return "phishing-resistant";
  if (methods.has("mfa") || methods.has("otp") || claims.acr?.toLowerCase().includes("mfa")) return "mfa";
  return "password";
}

export function normalizeVerifiedIdentity(claims: OidcClaims): VerifiedIdentity {
  if (!claims.iss || !claims.sub) throw new Error("Invalid OIDC identity claims");
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Identity token expired");
  return {
    issuer: claims.iss,
    subject: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true,
    assurance: assuranceFromClaims(claims),
  };
}
