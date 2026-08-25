import { authenticateRequest } from "@/security/request-auth";
import { oidcVerifierFromEnvironment } from "@/security/oidc-verifier";
import { resolveVerifiedIdentity } from "@/security/identity-resolution";
import { resolveOrganizationForActor } from "@/security/organization-selection";
import { resolveAccessContext, type AccessContext } from "@/security/access-context";

export async function resolveAuthenticatedContext(
  authorization: string | null,
  requestedOrganizationId?: string,
): Promise<AccessContext> {
  const verifier = oidcVerifierFromEnvironment();
  const verified = await authenticateRequest(authorization, verifier);
  const actor = await resolveVerifiedIdentity(verified);
  const organizationId = await resolveOrganizationForActor(actor.actorId, requestedOrganizationId);
  return resolveAccessContext(actor.actorId, organizationId);
}
