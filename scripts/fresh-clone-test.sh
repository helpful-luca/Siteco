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

API="http://127.0.0.1:$PORT/api"

# Upload through the proxy and wait until the document is indexed (pdfium, embedding, LanceDB).
ingest() {
  local name="$1" file="$2" body id status=""
  body="$(curl -sf -X POST "$API/documents" -H 'X-Requested-With: docchat' \
    -H 'Content-Type: application/octet-stream' -H "X-File-Name: $name" --data-binary "@$file")" \
    || { echo "upload of $name failed"; return 1; }
  id="$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
  for _ in $(seq 1 60); do
    status="$(curl -sf "$API/documents/$id" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)"
    if [ "$status" = "ready" ]; then
      curl -sf -H 'Range: bytes=0-4' "$API/documents/$id/file" -o /dev/null || return 1
      curl -sf -X DELETE -H 'X-Requested-With: docchat' "$API/documents/$id" || return 1
      echo "ingested and deleted: $name"
      return 0
    fi
    [ "$status" = "failed" ] && { echo "ingestion of $name failed"; return 1; }
    sleep 1
  done
  echo "ingestion of $name timed out (last status: $status)"
  return 1
}

smoke_ingestion() {
  printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 60>>stream\nBT /F1 12 Tf 72 720 Td (Die Leuchte hat Schutzart IP66.) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$WORK/smoke.pdf"
  printf 'Die Leuchte hat 5000 Lumen.\n' > "$WORK/smoke.txt"
  ingest smoke.pdf "$WORK/smoke.pdf" && ingest smoke.txt "$WORK/smoke.txt"
}

APP_PORT="$PORT" docker compose -p "$PROJECT" up --build -d
for _ in $(seq 1 90); do
  if body="$(curl -sf "$API/health/ready")"; then
    echo "ready: $body"
    echo "$body" | grep -q '"llm":"missing_key"' || { echo "expected missing_key without .env"; exit 1; }
    smoke_ingestion || { docker compose -p "$PROJECT" logs backend; exit 1; }
    echo "fresh clone OK"
    exit 0
  fi
  sleep 2
done
docker compose -p "$PROJECT" logs
exit 1
