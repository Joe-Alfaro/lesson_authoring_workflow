#!/usr/bin/env bash
# Builds the production image and runs web, worker and collab against a throwaway Postgres the
# way Railway runs them: migrate (web's pre-deploy), seed once, then health, sign-in and a
# two-user collab edit through the configured COLLAB_URL. Cleans up unless SMOKE_KEEP=1.
# Host ports: SMOKE_WEB_PORT (3920), SMOKE_COLLAB_PORT (3921), SMOKE_WORKER_PORT (3922).
set -euo pipefail
cd "$(dirname "$0")/.."

export SMOKE_WEB_PORT="${SMOKE_WEB_PORT:-3920}"
export SMOKE_COLLAB_PORT="${SMOKE_COLLAB_PORT:-3921}"
export SMOKE_WORKER_PORT="${SMOKE_WORKER_PORT:-3922}"
# Fresh throwaway values each run; never printed.
SMOKE_AUTH_SECRET="$(openssl rand -base64 32)"
SMOKE_SEED_PASSWORD="smoke-$(openssl rand -hex 12)"
export SMOKE_AUTH_SECRET SMOKE_SEED_PASSWORD

compose() { docker compose -f scripts/docker_smoke.compose.yml "$@"; }
cleanup() {
  if [ "${SMOKE_KEEP:-}" = 1 ]; then
    echo "SMOKE_KEEP=1: containers left running (docker compose -p law_deploy_smoke down -v)"
  else
    compose down -v --remove-orphans > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo '== build image'
compose build --quiet web
docker image ls lesson-authoring-workflow:smoke --format 'image size {{.Size}}'

echo '== postgres'
compose up -d --wait postgres

echo '== migrate (Railway pre-deploy command on web)'
compose run --rm --no-deps web node dist/db/migrate_cli.mjs

echo '== seed refuses to run without SEED_PASSWORD in production'
if compose run --rm --no-deps -e SEED_PASSWORD= web node dist/db/seed/seed_cli.mjs > /dev/null 2>&1; then
  echo 'FAIL seed ran without SEED_PASSWORD'
  exit 1
fi
echo 'PASS'

echo '== seed (one-time)'
compose run --rm --no-deps web node dist/db/seed/seed_cli.mjs

echo '== start web, worker, collab'
compose up -d --wait --no-build web worker collab

echo '== processes run as non-root'
for service in web worker collab; do
  uid="$(compose exec -T "$service" id -u)"
  if [ "$uid" = 0 ]; then
    echo "FAIL $service runs as root"
    exit 1
  fi
  echo "PASS $service uid $uid"
done

echo '== checks'
SMOKE_COLLAB_URL="$(compose exec -T web printenv COLLAB_URL)" \
  SMOKE_WEB_URL="http://localhost:$SMOKE_WEB_PORT" \
  SMOKE_WORKER_URL="http://localhost:$SMOKE_WORKER_PORT" \
  SMOKE_COLLAB_HTTP_URL="http://localhost:$SMOKE_COLLAB_PORT" \
  npx tsx scripts/docker_smoke_checks.ts
