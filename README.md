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
| `MCP_TOKEN` | no | empty | Optional bearer token for the MCP endpoint (see docs/mcp.md) |
| `LOG_LEVEL` | no | `INFO` | Backend log level |
| `MALWARE_SCAN` | no | `required` | `off` skips the virus scan (development only, the app shows a hint) |
| `OCR` | no | `on` | Tesseract (German and English) reads scanned pages; `off` leaves them unsearchable |

## MCP server

Claude Code and Claude Desktop can search your library: `claude mcp add --transport http docchat http://localhost:3000/api/mcp`. Details in [docs/mcp.md](docs/mcp.md).

## Development

    make dev-api     # FastAPI with hot reload on 127.0.0.1:8000
    make dev-web     # Next.js dev server on localhost:3000
    make test        # backend and frontend tests
    make lint        # linters, type checks and architecture boundaries
    make api-types   # regenerate contracts/openapi.json and the TypeScript types
    make fresh-clone # prove a clean clone starts without .env

## Desktop app (macOS)

A native window instead of a browser tab: double-click the app, it starts what it needs and opens Siteco Document Chat. Optional; the official way stays `docker compose up`. Needs Node 22.12 or newer to build and Docker Desktop to run.

    npm install            # root scripts plus desktop/ (downloads Electron, about 130 MB)
    npm run app:build      # unsigned .app for arm64 and x64 in desktop/release
    npm run app:install    # copies it to ~/Applications/Siteco Document Chat.app

What happens on a double-click:

1. If the app already answers on `http://localhost:3000` (identity check on `/api/health/live`), the window opens at once.
2. Otherwise a small splash finds the docker CLI, starts Docker Desktop if needed, runs `docker compose up --detach --build` in the project folder and waits for the app. The first start builds the images (a few minutes); later starts take seconds.
3. If something is missing (Docker not installed or not starting, port taken, compose error), the splash says what to do and offers "Erneut versuchen". "Details" shows the last lines of output.

Quitting leaves the containers running, so the next start is instant. "Dienste beenden" in the app menu runs `docker compose stop` and quits; your data stays in the Docker volumes.

The project folder is the repository the app was built from. If it moves, the app asks once for the folder (it must contain this project's `compose.yaml`) and remembers it. Settings live in `~/Library/Application Support/Siteco Document Chat/config.json` (`port` changes the port, passed to compose as `APP_PORT`).

The app is built and opened on the same Mac, so it carries no quarantine flag and Gatekeeper opens it without a prompt. It is only ad-hoc signed; handing it to others would need a Developer ID signature and notarization.

Security: context isolation, sandbox and no Node.js in the page; the page sees only `{ isDesktop, platform }`. Navigation stays on the app origin, popups are denied, http(s) links open in the default browser after validation, permission requests are denied (except clipboard writes for the copy buttons), and requests to any other origin are blocked. Electron fuses are hardened (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, encrypted cookies, code only from the integrity-checked `app.asar`). Crash reports stay on the Mac; there is no telemetry. Docker is called with `execFile` and fixed argument lists, never through a shell.

For development:

    npm run dev            # backend with hot reload, next dev and the Electron window
    npm run app            # Electron against the Docker stack, with the same startup as the .app
    npm run test:desktop   # unit tests (Vitest)
    npm run test:desktop:e2e  # Electron smoke test against a running app (skips if none)

## Status

Work in progress. Sections on decisions, evaluation and testing follow.
