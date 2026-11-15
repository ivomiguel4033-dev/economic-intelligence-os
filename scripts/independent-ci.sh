#!/usr/bin/env bash
# Independent CI replay. Run only on a disposable Linux host with Docker and Node 22.
# Generated from CI at 307190c03856c28ba3d2b0bd21e7fe1d326d40b2; review parity when CI changes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]]
command -v docker >/dev/null
command -v timeout >/dev/null
docker info >/dev/null
[[ -z "$(git status --porcelain)" ]] || { echo "Use a clean checkout"; exit 1; }
# Never use production credentials or a shared database.
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_test
export NEXT_TELEMETRY_DISABLED=1
# Reject inherited credentials and runtime overrides before executing any test.
for name in $(compgen -e); do
  case "${name^^}" in
    OIDC_*|AI_*|STRIPE_*|SECURITY_*|METRICS_*|RAILWAY_*|OPENAI_*|ANTHROPIC_*|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|PG*)
      echo "Unsafe inherited environment variable: $name" >&2; exit 1 ;;
  esac
done
db="eios-ci-$"
image="economic-intelligence-os:ci-$"
export image
cleanup() { docker rm -f "$db" >/dev/null 2>&1 || true; docker image rm "$image" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$db" -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_test postgres:16-alpine >/dev/null
for i in {1..60}; do
  if docker exec "$db" pg_isready -U postgres -d app_test >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$db" pg_isready -U postgres -d app_test
echo "Independent CI commit: $(git rev-parse HEAD)"
echo 'CI step 1/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_0'
if [ -f package-lock.json ]; then
  npm ci --ignore-scripts
else
  npm install --ignore-scripts --no-audit --no-fund
fi
EIOS_STEP_0
echo 'CI step 2/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_1'
node scripts/railway-config-contract.mjs
EIOS_STEP_1
echo 'CI step 3/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_2'
node scripts/validate-migrations.mjs
EIOS_STEP_2
echo 'CI step 4/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_3'
node scripts/migration-validation-regression.mjs
EIOS_STEP_3
echo 'CI step 5/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_4'
node scripts/validate-prometheus-alerts.mjs
EIOS_STEP_4
echo 'CI step 6/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_5'
npm run migrate
EIOS_STEP_5
echo 'CI step 7/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_6'
node scripts/migration-lock-regression.mjs
EIOS_STEP_6
echo 'CI step 8/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_7'
node scripts/database-concurrency-regression.mjs
EIOS_STEP_7
echo 'CI step 9/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_8'
node scripts/postgres-timeout-regression.mjs
EIOS_STEP_8
echo 'CI step 10/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_9'
node scripts/postgres-pool-saturation-regression.mjs
EIOS_STEP_9
echo 'CI step 11/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_10'
node scripts/outbox-concurrency-regression.mjs
EIOS_STEP_10
echo 'CI step 12/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_11'
node scripts/stripe-event-idempotency-regression.mjs
EIOS_STEP_11
echo 'CI step 13/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_12'
node scripts/stripe-customer-binding-regression.mjs
EIOS_STEP_12
echo 'CI step 14/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_13'
node scripts/stripe-signature-regression.mjs
EIOS_STEP_13
echo 'CI step 15/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_14'
node scripts/security-regression.mjs
EIOS_STEP_14
echo 'CI step 16/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_15'
node scripts/access-context-regression.mjs
EIOS_STEP_15
echo 'CI step 17/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_16'
node scripts/production-security-baseline-regression.mjs
EIOS_STEP_16
echo 'CI step 18/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_17'
node scripts/production-preflight-regression.mjs
EIOS_STEP_17
echo 'CI step 19/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_18'
node scripts/execution-reliability-regression.mjs
EIOS_STEP_18
echo 'CI step 20/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_19'
node scripts/ai-output-validation-regression.mjs
EIOS_STEP_19
echo 'CI step 21/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_20'
node scripts/prompt-injection-regression.mjs
EIOS_STEP_20
echo 'CI step 22/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_21'
node scripts/ai-failover-regression.mjs
EIOS_STEP_21
echo 'CI step 23/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_22'
node scripts/circuit-breaker-regression.mjs
EIOS_STEP_22
echo 'CI step 24/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_23'
node scripts/operational-slo-regression.mjs
EIOS_STEP_23
echo 'CI step 25/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_24'
node scripts/shutdown-drain-regression.mjs
EIOS_STEP_24
echo 'CI step 26/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_25'
node scripts/orchestrate-load-shedding-regression.mjs
EIOS_STEP_25
echo 'CI step 27/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_26'
node scripts/tenant-concurrency-regression.mjs
EIOS_STEP_26
echo 'CI step 28/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_27'
node scripts/distributed-tenant-concurrency-regression.mjs
EIOS_STEP_27
echo 'CI step 29/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_28'
npm run test:production-readiness
EIOS_STEP_28
echo 'CI step 30/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_29'
docker build --tag "$image" .
EIOS_STEP_29
echo 'CI step 31/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_30'
node scripts/production-image-contract.mjs --self-test
node scripts/production-image-contract.mjs "$image"
EIOS_STEP_30
echo 'CI step 32/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_31'
docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://app:secret@db.internal:5432/app \
  -e OIDC_ISSUER=https://identity.example.com/tenant \
  -e OIDC_AUDIENCE=economic-intelligence-os \
  -e OIDC_JWKS_URL=https://identity.example.com/.well-known/jwks.json \
  -e SECURITY_EVENT_HASH_PEPPER=0123456789abcdef0123456789abcdef \
  -e METRICS_TOKEN=abcdef0123456789abcdef0123456789 \
  -e AI_PRIMARY_BASE_URL=https://api.example.com/v1 \
  -e AI_PRIMARY_API_KEY=test-provider-key \
  -e AI_PRIMARY_MODEL=reasoning-model \
  "$image" \
  node scripts/production-preflight.mjs
EIOS_STEP_31
echo 'CI step 33/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_32'
node scripts/orchestrate-payload-regression.mjs
EIOS_STEP_32
echo 'CI step 34/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_33'
node scripts/decision-payload-regression.mjs
EIOS_STEP_33
echo 'CI step 35/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_34'
node scripts/stripe-webhook-payload-regression.mjs
EIOS_STEP_34
echo 'CI step 36/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_35'
node scripts/metrics-route-regression.mjs
EIOS_STEP_35
echo 'CI step 37/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_36'
node scripts/health-readiness-route-regression.mjs
EIOS_STEP_36
echo 'CI step 38/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_37'
if grep -R -n -E 'x-actor-id|x-organization-id' src/app/api; then
  echo 'Legacy trusted identity headers found in API routes.'
  exit 1
fi
EIOS_STEP_37
echo 'CI step 39/39'
timeout 600 bash -euo pipefail <<'EIOS_STEP_38'
if git grep -n -E '(sk-[A-Za-z0-9_-]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)' -- ':!package-lock.json'; then
  echo 'Potential committed secret detected.'
  exit 1
fi
EIOS_STEP_38
echo "Independent CI passed (not a GitHub required check)."
