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
# Prints the document id.
upload_ready() {
  local name="$1" file="$2" body id status=""
  body="$(curl -sf -X POST "$API/documents" -H 'X-Requested-With: docchat' \
    -H 'Content-Type: application/octet-stream' -H "X-File-Name: $name" --data-binary "@$file")" \
    || { echo "upload of $name failed" >&2; return 1; }
  id="$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
  for _ in $(seq 1 60); do
    status="$(curl -sf "$API/documents/$id" | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)"
    [ "$status" = "ready" ] && { echo "$id"; return 0; }
    [ "$status" = "failed" ] && { echo "ingestion of $name failed" >&2; return 1; }
    sleep 1
  done
  echo "ingestion of $name timed out (last status: $status)" >&2
  return 1
}

ingest() {
  local name="$1" file="$2" id
  id="$(upload_ready "$name" "$file")" || return 1
  curl -sf -H 'Range: bytes=0-4' "$API/documents/$id/file" -o /dev/null || return 1
  curl -sf -X DELETE -H 'X-Requested-With: docchat' "$API/documents/$id" || return 1
  echo "ingested and deleted: $name"
}

new_uuid() {
  python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || cat /proc/sys/kernel/random/uuid
}

# One question through the proxy as a server-sent event stream. $1: expected `done` status
# (`sources_only` without a key, `complete` with the fake model).
chat_round_trip() {
  local expected="$1" doc_id chat_id stream
  printf 'Die Leuchte Mira hat die Schutzart IP66.\n' > "$WORK/chat.txt"
  doc_id="$(upload_ready chat.txt "$WORK/chat.txt")" || return 1
  chat_id="$(curl -sf -X POST "$API/chats" -H 'X-Requested-With: docchat' \
    -H 'Content-Type: application/json' \
    -d "{\"scope\":\"selected\",\"document_ids\":[\"$doc_id\"]}" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)" || { echo "chat not created"; return 1; }
  stream="$(curl -sfN -X POST "$API/chats/$chat_id/messages" -H 'X-Requested-With: docchat' \
    -H 'Content-Type: application/json' \
    -d "{\"client_message_id\":\"$(new_uuid)\",\"content\":\"Welche Schutzart hat die Mira?\",\"model\":\"claude-sonnet-5-5\",\"locale\":\"de\"}")" \
    || { echo "answer stream failed"; return 1; }
  echo "$stream" | head -1 | grep -q '^event: meta' || { echo "stream did not start with meta: $stream"; return 1; }
  echo "$stream" | grep -q '^event: sources' || { echo "no sources event: $stream"; return 1; }
  echo "$stream" | grep -A1 '^event: done' | grep -q "\"status\":\"$expected\"" \
    || { echo "expected done status $expected: $stream"; return 1; }
  if [ "$expected" = "complete" ]; then
    echo "$stream" | grep -q '^event: citation' || { echo "no citation: $stream"; return 1; }
  fi
  curl -sf -X DELETE -H 'X-Requested-With: docchat' "$API/chats/$chat_id" || return 1
  curl -sf -X DELETE -H 'X-Requested-With: docchat' "$API/documents/$doc_id" || return 1
  echo "chat round trip OK: $expected"
}

# Restart only the backend with the fake model and answer one question end to end.
smoke_fake_chat() {
  local body=""
  LLM_PROVIDER=fake APP_PORT="$PORT" docker compose -p "$PROJECT" up -d backend
  for _ in $(seq 1 90); do
    body="$(curl -sf "$API/health/ready" || true)"
    if echo "$body" | grep -q '"llm":"ok"'; then
      chat_round_trip complete
      return
    fi
    sleep 2
  done
  echo "backend with LLM_PROVIDER=fake did not become ready: $body"
  return 1
}

# The EICAR test file, assembled here so the repository never contains it in one piece.
write_eicar() {
  printf '%s%s%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$' 'EICAR-STANDARD-' 'ANTIVIRUS-TEST-FILE!$H+H*' > "$1"
}

wait_for_clamd() {
  local cid health=""
  cid="$(docker compose -p "$PROJECT" ps -q clamav)"
  for _ in $(seq 1 150); do
    health="$(docker inspect -f '{{.State.Health.Status}}' "$cid")"
    if [ "$health" = "healthy" ]; then echo "clamd ready"; return 0; fi
    sleep 2
  done
  echo "clamd did not become healthy (last: $health)"
  return 1
}

# EICAR must end as failed with MALWARE_DETECTED and never reach the library or the quarantine.
smoke_malware() {
  local body id doc=""
  write_eicar "$WORK/eicar.txt"
  body="$(curl -sf -X POST "$API/documents" -H 'X-Requested-With: docchat' \
    -H 'Content-Type: application/octet-stream' -H 'X-File-Name: eicar.txt' \
    --data-binary "@$WORK/eicar.txt")" || { echo "upload of eicar.txt failed"; return 1; }
  id="$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
  for _ in $(seq 1 60); do
    doc="$(curl -sf "$API/documents/$id")"
    if echo "$doc" | grep -q '"status":"failed"'; then
      echo "$doc" | grep -q '"error_code":"MALWARE_DETECTED"' || { echo "unexpected: $doc"; return 1; }
      if docker compose -p "$PROJECT" exec -T backend sh -c "ls /data/uploads /data/quarantine 2>/dev/null" | grep -q "$id"; then
        echo "infected file left on disk"; return 1
      fi
      curl -sf -X DELETE -H 'X-Requested-With: docchat' "$API/documents/$id" || return 1
      echo "EICAR rejected: $(echo "$doc" | grep -o '"signature":"[^"]*"')"
      return 0
    fi
    sleep 1
  done
  echo "EICAR was not rejected in time: $doc"
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
    wait_for_clamd || { docker compose -p "$PROJECT" logs clamav; exit 1; }
    smoke_malware || { docker compose -p "$PROJECT" logs backend; exit 1; }
    smoke_ingestion || { docker compose -p "$PROJECT" logs backend; exit 1; }
    chat_round_trip sources_only || { docker compose -p "$PROJECT" logs backend; exit 1; }
    smoke_fake_chat || { docker compose -p "$PROJECT" logs backend; exit 1; }
    echo "fresh clone OK"
    exit 0
  fi
  sleep 2
done
docker compose -p "$PROJECT" logs
exit 1
