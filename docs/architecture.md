# Architecture

One local workspace: no login, no session cookie. Browser and desktop window see the same data.

```
Browser or desktop window (localhost:3000)
  -> frontend container: Next.js 16, bound to 127.0.0.1
       /api/[...path]: own streaming proxy (CSRF guard, header allowlist, body limits)
  -> backend container: FastAPI, one Uvicorn worker, no host port
       SQLite   /data/app.db     truth: documents, chats, messages, preferences, usage ledger
       LanceDB  /data/lancedb    index only: chunks, vectors, BM25 (one writer, one write lock)
       files    /data/uploads    originals under UUID names; /data/quarantine until scanned
       models   /opt/models      embedding model baked into the image, offline
  -> clamav container: clamd, internal network, INSTREAM over TCP
  -> Anthropic API (optional), key only in the backend
```

Guiding rules:

1. SQLite is the truth, LanceDB is an index. Retrieval only returns chunks of documents SQLite lists as `ready`, so a half written or deleted document is invisible.
2. Errors are stable codes (`domain/errors.py`), never texts. The UI renders `errors.<CODE>` in German or English. Every stream ends with exactly one `done` or `error` event.
3. One process, one writer: one worker, one ingestion queue, one write lock, one PDF parser process.

## Backend layers

```
api        thin HTTP: routes, request and response schemas, error envelope
services   use cases: upload, ingestion worker, retrieval, answer run, chats, export, purge
domain     pure rules and ports: chunking, sentences, citations, prompt, limits, error codes
adapters   implementations of the ports: SQLite, LanceDB, pdfium, Tesseract, clamd, Anthropic, fake LLM
core       config and container.py, the only place that wires concrete adapters
```

`import-linter` fails CI when a layer imports upward or `domain` touches I/O. One responsibility per file, no `utils.py`.

## Ingestion

Upload (raw body, size, quota and disk checks, magic bytes while streaming) writes into quarantine and a `scanning` row. The scan worker asks clamd, then moves the file into the library and queues it. The ingestion worker takes documents by page count (small files overtake catalogs, at most 5 times), parses in a separate pdfium process in batches of 50 pages with a timeout per batch, OCRs pages without text, chunks into a JSONL spool, then embeds from the spool in batches and writes to LanceDB. Only at the end the row becomes `ready`. Memory stays flat from 150 to 1500 pages. A restart re-queues interrupted work and sweeps orphans.

## Answering

1. The question is validated and rate limited; a follow-up is rewritten for search with the recent history.
2. `RetrievalService` runs vector search and BM25 (German stemming), fuses them with reciprocal rank fusion (20 candidates), then selects 8 passages with a cap per document. Small scopes can use the whole text.
3. The request to Claude holds the passages as `search_result` blocks (one text block per sentence, citations enabled), a short turn context and the question. Documents never appear in the system prompt or the question.
4. Claude streams text and citation events. The pure `AnswerAssembler` places each citation at the end of its text block and maps it by `source` (the chunk id) to document, page and sentence range.
5. The SSE stream (`meta`, `status`, `sources`, text deltas, `citation`, `done` or `error`) is persisted as it goes. Stop cancels the task and saves the partial answer as `stopped`; a vanished client marks it `interrupted`.
6. Without a key the same path ends after `sources` with status `sources_only`.

`LLM_PROVIDER=fake` swaps the Claude client for a deterministic one behind the same port, with scenarios for every error path (`#fake:slow`, `#fake:overloaded`, and so on in the question).

## Frontend

`src/app` holds routes and layouts only. Features live in `src/features/<name>` behind `index.ts` (chat, library, citations, viewer, settings, onboarding, shell). `src/shared` never imports features: API client and generated types, markdown, i18n, preferences, UI primitives on Base UI. Server state is TanStack Query. The theme and language come from cookies mirrored from the backend so nothing flashes. The PDF viewer is react-pdf with an own highlight overlay, loading by range requests so a large catalog opens on the cited page at once.

## Contract

Pydantic produces `contracts/openapi.json`; `frontend/src/shared/api/schema.gen.ts` is generated from it. CI fails on drift, so frontend and backend cannot diverge silently.

## Other parts

- MCP server on `/api/mcp` (stateless streamable HTTP, two read only tools): [mcp.md](mcp.md).
- macOS desktop app (Electron) in `desktop/`: a window around the same stack, started by Docker.
- Retrieval eval in `eval/` and `backend/src/docchat/cli/`: [evaluation.md](evaluation.md).
- Decisions with rejected alternatives: [decisions.md](decisions.md). Error codes: [errors.md](errors.md).
