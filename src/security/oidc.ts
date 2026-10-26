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

// Treat ACR as a provider-defined identifier, not free text: substring matches
// such as "no-mfa" or "untrusted-phr" must never grant step-up assurance.
export function assuranceFromClaims(amr: unknown, acr: unknown): VerifiedIdentity["assurance"] {
  const methods = new Set(
    Array.isArray(amr)
      ? amr.filter((method): method is string => typeof method === "string").map((method) => method.toLowerCase())
      : [],
  );
  const acrToken = typeof acr === "string" ? acr.toLowerCase().split(/[/:]/).at(-1) : undefined;
  if (["webauthn", "hwk", "fido", "fido2"].some((method) => methods.has(method)) ||
      ["phishing", "phishing-resistant", "aal3", "phr"].includes(acrToken ?? "")) {
    return "phishing-resistant";
  }
  if (["mfa", "otp", "totp", "sms"].some((method) => methods.has(method)) ||
      ["mfa", "aal2"].includes(acrToken ?? "")) {
    return "mfa";
  }
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
    assurance: assuranceFromClaims(claims.amr, claims.acr),
  };
}
