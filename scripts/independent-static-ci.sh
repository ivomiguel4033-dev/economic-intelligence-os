#!/usr/bin/env bash
set -euo pipefail
# Fail before Node starts if inherited settings could redirect execution.
for name in $(compgen -e); do
  case "${name^^}" in
    OIDC_*|AI_*|STRIPE_*|SECURITY_*|METRICS_*|RAILWAY_*|OPENAI_*|ANTHROPIC_*|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|PG*|DATABASE_URL)
      echo "Unsafe inherited environment variable: $name" >&2; exit 1 ;;
  esac
done
cd "$(git rev-parse --show-toplevel)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || { echo 'Node 22 required' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Clean checkout required' >&2; exit 1; }
checks=(
  scripts/railway-config-contract.mjs
  scripts/production-preflight-regression.mjs
  scripts/validate-migrations.mjs
  scripts/validate-prometheus-alerts.mjs
  scripts/production-smoke-regression.mjs
  scripts/production-smoke-boundary-regression.mjs
  scripts/production-release-evidence-check-suite.mjs
  scripts/railway-config-regression.mjs
)
# Preflight all paths before running any check.
for check in "${checks[@]}" scripts/production-image-contract.mjs; do
  [[ -f "$check" && ! -L "$check" ]] || { echo "Missing or unsafe check: $check" >&2; exit 1; }
done
for check in "${checks[@]}"; do
  echo "Running $check"
  timeout 180 node "$check"
done
timeout 180 node scripts/production-image-contract.mjs --self-test
printf 'PARTIAL PASS: %s; database, build and actual image checks NOT RUN\n' "$(git rev-parse HEAD)"
