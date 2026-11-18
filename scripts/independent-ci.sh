#!/usr/bin/env bash
# Independent CI replay. Run only on a disposable Linux host with Docker and Node 22.
# Generated from CI at 307190c03856c28ba3d2b0bd21e7fe1d326d40b2; review parity when CI changes.
set -euo pipefail
# Reject inherited credentials and runtime overrides before executing any test.
for name in $(compgen -e); do
  case "${name^^}" in
    OIDC_*|AI_*|STRIPE_*|SECURITY_*|METRICS_*|RAILWAY_*|OPENAI_*|ANTHROPIC_*|MISTRAL_*|COHERE_*|GROQ_*|HUGGINGFACE_*|HF_TOKEN|TOGETHER_*|DEEPSEEK_*|FIREWORKS_*|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|SESSION_SECRET|JWT_SECRET|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|PG*|AWS_*|AZURE_*|GOOGLE_*|GCP_*|GITHUB_TOKEN|GH_TOKEN|AUTH_*|NEXTAUTH_*|DATABASE_*|ALLOW_MIGRATION_CHECKSUM_BASELINE|MIGRATION_*|BASH_ENV|ENV|BASH_FUNC_*|LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|NODE_PATH|ALLOW_INSECURE_AUTH|DOCKER_*|BUILDX_*|BUILDKIT_*|GIT_*|NPM_CONFIG_*|NPM_TOKEN|NODE_AUTH_TOKEN|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|CURL_CA_BUNDLE|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)
      echo "Unsafe inherited environment variable: $name" >&2; exit 1 ;;
  esac
done
if ! repo_root="$(git rev-parse --show-toplevel)" || [[ -z "$repo_root" ]]; then
  echo "Unable to resolve checkout root" >&2; exit 2
fi
cd -- "$repo_root"
# Ignored dotenv files can contain production credentials even in a clean checkout.
for env_file in .npmrc .env .env.local .env.development .env.development.local .env.production .env.production.local .env.test .env.test.local; do
  if [[ -e "$env_file" || -L "$env_file" ]]; then
    echo "Unsafe local environment file: $env_file" >&2
    exit 1
  fi
done
# Require a committed lockfile before allocating any Docker resources.
if [[ ! -f package-lock.json || -L package-lock.json ]] || ! git cat-file -e HEAD:package-lock.json 2>/dev/null || ! git diff --quiet HEAD -- package-lock.json || ! lockfile_blob="$(git hash-object --no-filters -- package-lock.json)" || ! committed_blob="$(git rev-parse HEAD:package-lock.json)" || [[ "$lockfile_blob" != "$committed_blob" ]]; then
  echo "Missing or modified committed regular package-lock.json; generate, review and commit it before replay." >&2
  exit 1
fi
for dependency in node npm docker timeout; do
  if ! command -v "$dependency" >/dev/null; then
    echo "Missing required executable: $dependency" >&2; exit 1
  fi
done
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
  echo "Node.js 22 is required" >&2; exit 1
fi
# Scan before starting containers or installing dependencies; never print matches.
scan_secrets() {
  local status
  if git grep -E '(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|BEGIN ([A-Z0-9]+ )*PRIVATE KEY)' "$@" -- ':!package-lock.json' >/dev/null 2>&1; then
    echo 'Potential secret detected.' >&2
    return 1
  else
    status=$?
    if (( status != 1 )); then
      echo "Security scan failed (exit $status)." >&2
      return "$status"
    fi
  fi
}
scan_secrets HEAD
scan_secrets
export -f scan_secrets
# Pin every Docker invocation, including child scripts, to the local daemon.
# A saved Docker context can otherwise point at a remote production host.
export DOCKER_HOST=unix:///var/run/docker.sock
# Do not read registry credentials or credential helpers from the host Docker config.
docker_config_dir="$(mktemp -d)"
export DOCKER_CONFIG="$docker_config_dir"
# Cover failures before the full resource cleanup trap is installed.
trap 'rm -rf -- "$docker_config_dir"' EXIT
if ! timeout --kill-after=5s 30 docker info >/dev/null; then
  echo "Docker daemon unavailable or unresponsive" >&2; exit 1
fi
if ! checkout_status="$(git status --porcelain)"; then
  echo "Unable to verify checkout cleanliness" >&2; exit 2
fi
[[ -z "$checkout_status" ]] || { echo "Use a clean checkout"; exit 1; }
# Never use production credentials or a shared database.

export NEXT_TELEMETRY_DISABLED=1

run_id="$(node -p 'require("node:crypto").randomUUID()')"
db="eios-ci-$run_id"
image="economic-intelligence-os:ci-$run_id"
export image
smoke="eios-smoke-$run_id"
export smoke
smoke_created=0
db_created=0
image_created=0
npm_config_dir=""
cleanup_resource() {
  if ! timeout --kill-after=5s 30s docker "$@" >/dev/null 2>&1; then
    echo "Warning: Docker cleanup failed: $*" >&2
    return 1
  fi
}
cleanup() {
  local original_status=$? cleanup_failed=0
  trap - EXIT
  if [[ -n "$npm_config_dir" ]]; then
    if ! rm -rf -- "$npm_config_dir"; then
      echo "Warning: npm temporary directory cleanup failed" >&2
      cleanup_failed=1
    fi
  fi
  if [[ "$smoke_created" == 1 ]]; then cleanup_resource rm -f -v "$smoke" || cleanup_failed=1; fi
  if [[ "$db_created" == 1 ]]; then cleanup_resource rm -f -v "$db" || cleanup_failed=1; fi
  if [[ "$image_created" == 1 ]]; then cleanup_resource image rm "$image" || cleanup_failed=1; fi
  if ! rm -rf -- "$docker_config_dir"; then
    echo "Warning: Docker temporary configuration cleanup failed" >&2
    cleanup_failed=1
  fi
  if (( original_status == 0 && cleanup_failed != 0 )); then exit 1; fi
  exit "$original_status"
}
trap cleanup EXIT
# Preserve conventional signal exit codes and run EXIT cleanup on interruption.
trap 'exit 130' INT
trap 'exit 143' TERM
# Ignore host npm configuration and caches, which may contain private registry credentials.
npm_config_dir="$(mktemp -d)"
touch "$npm_config_dir/user" "$npm_config_dir/global"
export npm_config_userconfig="$npm_config_dir/user"
export npm_config_globalconfig="$npm_config_dir/global"
export npm_config_cache="$npm_config_dir/cache"
# Register cleanup before Docker can create a resource and then fail or be interrupted.
db_created=1
timeout --kill-after=5s 120s docker run -d --name "$db" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_test postgres:16-alpine >/dev/null
# Use the actual ephemeral host port, never an unrelated local PostgreSQL.
binding="$(timeout --kill-after=5s 30s docker port "$db" 5432/tcp)"
if [[ ! "$binding" =~ ^127\.0\.0\.1:([0-9]{1,5})$ ]]; then
  echo "Unexpected PostgreSQL port binding" >&2; exit 1
fi
port="${BASH_REMATCH[1]}"
if (( 10#$port < 1 || 10#$port > 65535 )); then
  echo "Invalid PostgreSQL port" >&2; exit 1
fi
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$port/app_test"
for i in {1..60}; do
  if timeout --kill-after=2s 5 docker exec "$db" pg_isready -h 127.0.0.1 -U postgres -d app_test >/dev/null 2>&1; then break; fi
  sleep 1
done
timeout --kill-after=2s 5 docker exec "$db" pg_isready -h 127.0.0.1 -U postgres -d app_test
echo "Independent CI commit: $(git rev-parse HEAD)"
echo 'CI step 1/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_0'
npm ci --ignore-scripts
EIOS_STEP_0
echo 'CI step 2/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_1'
node scripts/railway-config-contract.mjs
EIOS_STEP_1
echo 'CI step 3/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_2'
node scripts/validate-migrations.mjs
EIOS_STEP_2
echo 'CI step 4/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_3'
node scripts/migration-validation-regression.mjs
EIOS_STEP_3
echo 'CI step 5/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_4'
node scripts/validate-prometheus-alerts.mjs
EIOS_STEP_4
echo 'CI step 6/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_5'
npm run migrate
EIOS_STEP_5
echo 'CI step 7/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_6'
node scripts/migration-lock-regression.mjs
EIOS_STEP_6
echo 'CI step 8/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_7'
node scripts/database-concurrency-regression.mjs
EIOS_STEP_7
echo 'CI step 9/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_8'
node scripts/postgres-timeout-regression.mjs
EIOS_STEP_8
echo 'CI step 10/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_9'
node scripts/postgres-pool-saturation-regression.mjs
EIOS_STEP_9
echo 'CI step 11/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_10'
node scripts/outbox-concurrency-regression.mjs
EIOS_STEP_10
echo 'CI step 12/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_11'
node scripts/stripe-event-idempotency-regression.mjs
EIOS_STEP_11
echo 'CI step 13/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_12'
node scripts/stripe-customer-binding-regression.mjs
EIOS_STEP_12
echo 'CI step 14/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_13'
node scripts/stripe-signature-regression.mjs
EIOS_STEP_13
echo 'CI step 15/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_14'
node scripts/security-regression.mjs
EIOS_STEP_14
echo 'CI step 16/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_15'
node scripts/access-context-regression.mjs
EIOS_STEP_15
echo 'CI step 17/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_16'
node scripts/production-security-baseline-regression.mjs
EIOS_STEP_16
echo 'CI step 18/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_17'
node scripts/production-preflight-regression.mjs
EIOS_STEP_17
echo 'CI step 19/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_18'
node scripts/execution-reliability-regression.mjs
EIOS_STEP_18
echo 'CI step 20/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_19'
node scripts/ai-output-validation-regression.mjs
EIOS_STEP_19
echo 'CI step 21/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_20'
node scripts/prompt-injection-regression.mjs
EIOS_STEP_20
echo 'CI step 22/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_21'
node scripts/ai-failover-regression.mjs
EIOS_STEP_21
echo 'CI step 23/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_22'
node scripts/circuit-breaker-regression.mjs
EIOS_STEP_22
echo 'CI step 24/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_23'
node scripts/operational-slo-regression.mjs
EIOS_STEP_23
echo 'CI step 25/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_24'
node scripts/shutdown-drain-regression.mjs
EIOS_STEP_24
echo 'CI step 26/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_25'
node scripts/orchestrate-load-shedding-regression.mjs
EIOS_STEP_25
echo 'CI step 27/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_26'
node scripts/tenant-concurrency-regression.mjs
EIOS_STEP_26
echo 'CI step 28/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_27'
node scripts/distributed-tenant-concurrency-regression.mjs
EIOS_STEP_27
echo 'CI step 29/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_28'
npm run test:production-readiness
EIOS_STEP_28
image_created=1
echo 'CI step 30/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_29'
docker build --tag "$image" .
EIOS_STEP_29
echo 'CI step 31/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_30'
node scripts/production-image-contract.mjs --self-test
node scripts/production-image-contract.mjs "$image"
EIOS_STEP_30
smoke_created=1
echo 'CI step 32/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_31'
# Preflight validates configuration only; prohibit network access and remote image pulls.
docker run --rm --name "$smoke" --network none --pull never \
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
smoke_created=0
echo 'CI step 33/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_32'
node scripts/orchestrate-payload-regression.mjs
EIOS_STEP_32
echo 'CI step 34/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_33'
node scripts/decision-payload-regression.mjs
EIOS_STEP_33
echo 'CI step 35/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_34'
node scripts/stripe-webhook-payload-regression.mjs
EIOS_STEP_34
echo 'CI step 36/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_35'
node scripts/metrics-route-regression.mjs
EIOS_STEP_35
echo 'CI step 37/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_36'
node scripts/health-readiness-route-regression.mjs
EIOS_STEP_36
echo 'CI step 38/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_37'
if grep -R -n -E 'x-actor-id|x-organization-id' src/app/api; then
  echo 'Legacy trusted identity headers found in API routes.'
  exit 1
else
  status=$?
  if (( status != 1 )); then
    echo "Security scan failed (exit $status)." >&2
    exit "$status"
  fi
fi
EIOS_STEP_37
echo 'CI step 39/39'
timeout --kill-after=30s 600 bash -euo pipefail <<'EIOS_STEP_38'
# Never print matching secret material into CI logs.
scan_secrets HEAD
scan_secrets
EIOS_STEP_38
cleanup

