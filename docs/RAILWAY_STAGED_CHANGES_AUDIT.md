# Railway staged-change audit (PR #11)

Do not deploy or accept the legacy Railway staged changes as a batch. Record a separate decision for every pending change in the target environment before the first production promotion.

## Inventory and decision record

For each staged item, record: service, setting name (never its secret value), old/new setting *type*, reason, owner, and decision: **keep**, **discard**, or **replace after review**. Record the total number inspected and reconcile it against the Railway pending-change count; PR #11 previously identified 14 legacy items, but the live count must be checked again.

## Mandatory release holds

- Keep the obsolete worker service inactive until a reviewed current entrypoint and isolated worker smoke test exist.
- Require production OIDC issuer, audience and JWKS configuration, plus a verified primary AI provider, without exposing credentials.
- Confirm the web service build, migration command, readiness check and graceful drain settings match the candidate commit.
- Verify a restorable database backup and an application rollback target. For first launch, document traffic-disable recovery instead.
- If any staged item is unexplained, any owner is missing, or the reviewed inventory differs from the applied change set, mark the release **NO-GO**.

Attach the redacted inventory, reviewer approval and UTC decision timestamp to the release evidence. See `docs/production-readiness-gates.md` and `docs/PRODUCTION_ROLLBACK_DRILL.md` for deployment and recovery gates.
