# Siteco Document Chat

Upload documents, ask questions, get answers with exact sources that are highlighted in the original file.

## Quick start

Prerequisites: Docker Desktop (or any Docker with Compose v2) and about 4 GB of free memory (backend up to 2 GB, virus scanner about 1 GB).

    cp .env.example .env        # optional: add ANTHROPIC_API_KEY
    docker compose up --build

Open http://localhost:3000.

- Without an API key the app still starts, explains how to add one and runs in search-only mode.
- The first build needs internet: it downloads dependencies, the web font and the local embedding model (about 400 MB) and verifies the model works offline. After that the app runs fully offline, except for calls to the Claude API.
- Every upload is checked by ClamAV before it enters the library. The scanner starts with the signatures shipped in its image (a few seconds on a current Mac, up to a minute on slower machines) and updates them when online. Until it answers, uploads wait with the status "Wird geprüft". It needs about 1 GB of memory.
- Only the web app is published on the host (`127.0.0.1:3000`). The backend is reachable only inside the Compose network.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | no | empty | Claude API key, read only by the backend container |
| `APP_PORT` | no | `3000` | Host port of the web app |
| `INTERNAL_TOKEN` | no | empty | Optional shared secret between web app and backend |
| `LOG_LEVEL` | no | `INFO` | Backend log level |
| `MALWARE_SCAN` | no | `required` | `off` skips the virus scan (development only, the app shows a hint) |
| `OCR` | no | `on` | Tesseract (German and English) reads scanned pages; `off` leaves them unsearchable |

## Development

    make dev-api     # FastAPI with hot reload on 127.0.0.1:8000
    make dev-web     # Next.js dev server on localhost:3000
    make test        # backend and frontend tests
    make lint        # linters, type checks and architecture boundaries
    make api-types   # regenerate contracts/openapi.json and the TypeScript types
    make fresh-clone # prove a clean clone starts without .env

## Status

Work in progress. Sections on decisions, evaluation and testing follow.
