#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 22 ]] || { echo 'Node 22 required' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Clean checkout required' >&2; exit 1; }
checks=(
  scripts/railway-config-contract.mjs
  scripts/validate-migrations.mjs
  scripts/validate-prometheus-alerts.mjs
  scripts/production-smoke-regression.mjs
  scripts/production-smoke-boundary-regression.mjs
  scripts/production-release-evidence-check-suite.mjs
  scripts/railway-config-regression.mjs
)
for check in "${checks[@]}"; do
  echo "Running $check"
  timeout 180 node "$check"
done
timeout 180 node scripts/production-image-contract.mjs --self-test
printf 'PARTIAL PASS: %s; database, build and actual image checks NOT RUN\n' "$(git rev-parse HEAD)"
