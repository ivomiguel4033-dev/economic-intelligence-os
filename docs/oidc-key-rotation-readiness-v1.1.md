# OIDC key-rotation and outage readiness — v1.1

This is an operator procedure for PR #11. It does not establish that production OIDC credentials are configured or authorize a Railway deployment.

## Before the first production release

1. Confirm the production `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URL` are configured on the **web** service, using approved secret management. Never paste values containing tokens or secrets into tickets or CI logs.
2. Verify the issuer's discovery metadata and JWKS endpoint over HTTPS from the intended runtime network. Confirm that the configured issuer matches the issuer in issued tokens exactly and that the intended audience is present.
3. Obtain two **non-production** test identities with distinct tenant permissions. Validate successful authentication for the authorized identity and rejection of a token with a wrong issuer, wrong audience, expired signature validity, or unknown key ID. Never put real tokens in a committed test fixture.
4. Confirm the application rejects authentication when the JWKS endpoint is unavailable and there is no valid previously verified key. A temporary identity-provider outage must not turn into an authorization bypass.
5. Record the test run, UTC time, deployed commit SHA and reviewer in the production release evidence record. A passing CI job alone does not prove the live identity provider is reachable.

## Planned signing-key rotation

1. Ask the identity-provider operator to publish the **new public key** in JWKS before using it to sign tokens. Keep the old key available for the existing token lifetime plus any documented clock skew and cache lifetime.
2. Verify that tokens signed with the new key are accepted only after the key is published, while valid tokens signed with the old key continue to work during overlap.
3. After the overlap period, remove the old key and confirm that tokens signed with the retired key are rejected once their allowed validity/cache window ends.
4. Record key identifiers (`kid` only), timing, observed success/failure and rollback owner. Never log private keys, bearer tokens or raw Authorization headers.

## Unexpected provider outage or rotation failure

- **HOLD** any release if issuer/JWKS validation fails, tokens with invalid claims are accepted, or key-rotation behavior is unknown.
- Do not disable JWT signature, issuer, audience, expiration or tenant-membership verification to restore availability.
- Check provider availability, TLS/DNS, key publication timing and application logs using redacted identifiers. Distinguish a JWKS fetch outage from an invalid-token rejection.
- If a newly deployed application introduced the failure, assess database compatibility and follow `docs/production-rollback-evidence-v1.1.md` using the recorded last-known-good deployment. Re-run the production smoke gate **and** authentication checks after recovery; smoke health alone cannot validate OIDC.
- Escalate to the identity-provider operator if no valid signing keys can be obtained. Keep production promotion blocked until authentication is verified.

Cross-reference: `docs/production-release-evidence-record-v1.1.md` and `docs/railway-staged-change-reconciliation-v1.1.md`.
