#!/usr/bin/env bash
# Browser E2E against the real Docker stack, twice: with the fake model (full chat) and without
# an API key (search only). Own compose project and port, so it never touches a running app.
# Needs Docker and `npx playwright install chromium` (CI) or Chrome (E2E_CHANNEL=chrome).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PORT="${E2E_PORT:-3700}"
PROJECT="docchat-e2e"
export APP_PORT="$PORT" E2E_BASE_URL="http://127.0.0.1:$PORT"

cleanup() {
  if [ "${KEEP_STACK:-0}" != "1" ]; then docker compose -p "$PROJECT" down -v >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

wait_for_llm() {
  local want="$1" body=""
  for _ in $(seq 1 90); do
    body="$(curl -sf "$E2E_BASE_URL/api/health/ready" || true)"
    if echo "$body" | grep -q "\"llm\":\"$want\""; then return 0; fi
    sleep 2
  done
  echo "stack did not reach llm=$want: $body"
  docker compose -p "$PROJECT" logs --tail 80
  return 1
}

echo "== with the fake model"
LLM_PROVIDER=fake docker compose -p "$PROJECT" up --build -d
wait_for_llm ok
(cd frontend && E2E_RUN=fake npm run test:e2e)

echo "== without an API key"
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY= docker compose -p "$PROJECT" up -d backend
wait_for_llm missing_key
(cd frontend && E2E_RUN=nokey npm run test:e2e)

echo "e2e OK"
