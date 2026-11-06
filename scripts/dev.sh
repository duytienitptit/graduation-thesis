#!/usr/bin/env bash
# Starts everything for local development: services, database, API and web.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then run pnpm dev again." >&2
  exit 1
fi

docker compose up -d --wait

# The MinIO image has no shell for a Compose health check, so wait from here.
for _ in $(seq 1 30); do
  curl -sf http://localhost:9000/minio/health/live >/dev/null && break
  sleep 1
done

pnpm --filter api prisma:generate
pnpm --filter api prisma:deploy
pnpm --filter api prisma:seed

exec pnpm exec concurrently --kill-others --names api,web --prefix-colors blue,magenta \
  "pnpm --filter api dev" "pnpm --filter web dev"
