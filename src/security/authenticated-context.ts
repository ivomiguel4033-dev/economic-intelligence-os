import { authenticateRequest } from "@/security/request-auth";
import { oidcVerifierFromEnvironment } from "@/security/oidc-verifier";
import { resolveVerifiedIdentity } from "@/security/identity-resolution";
import { resolveOrganizationForActor } from "@/security/organization-selection";
import { resolveAccessContext, type AccessContext } from "@/security/access-context";
import type { AuthAssurance } from "@/security/step-up-auth";

export interface AuthenticatedAccessContext extends AccessContext {
  assurance: AuthAssurance;
  authenticatedAt: string;
}

export async function resolveAuthenticatedContext(
  authorization: string | null,
  requestedOrganizationId?: string,
): Promise<AuthenticatedAccessContext> {
  const verifier = oidcVerifierFromEnvironment();
  const verified = await authenticateRequest(authorization, verifier);
  const actor = await resolveVerifiedIdentity(verified);
  const organizationId = await resolveOrganizationForActor(actor.actorId, requestedOrganizationId);
  const access = await resolveAccessContext(actor.actorId, organizationId);
  return {
    ...access,
    assurance: verified.assurance,
    authenticatedAt: new Date((verified.authTime ?? verified.issuedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}
