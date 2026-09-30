#!/usr/bin/env bash
# Clones the current commit into a temp dir and proves it starts the way a reviewer would run it:
# no .env, no brain/, no case brief, only `docker compose up`.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
PORT="${FRESH_PORT:-3900}"
PROJECT="docchat-fresh"

cleanup() {
  (cd "$WORK/app" 2>/dev/null && docker compose -p "$PROJECT" down -v >/dev/null 2>&1) || true
  rm -rf "$WORK"
}
trap cleanup EXIT

git clone --quiet "$REPO_ROOT" "$WORK/app"
cd "$WORK/app"

for forbidden in .env brain siteco-case-ai-document-chat.html; do
  if [ -e "$forbidden" ]; then echo "forbidden file in clone: $forbidden"; exit 1; fi
done

APP_PORT="$PORT" docker compose -p "$PROJECT" up --build -d
for _ in $(seq 1 90); do
  if body="$(curl -sf "http://127.0.0.1:$PORT/api/health/ready")"; then
    echo "ready: $body"
    echo "$body" | grep -q '"llm":"missing_key"' || { echo "expected missing_key without .env"; exit 1; }
    echo "fresh clone OK"
    exit 0
  fi
  sleep 2
done
docker compose -p "$PROJECT" logs
exit 1
