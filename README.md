# Document Chat

[![CI](https://github.com/helpful-luca/Siteco/actions/workflows/ci.yml/badge.svg)](https://github.com/helpful-luca/Siteco/actions/workflows/ci.yml)

Upload your documents and ask questions about them in German or English. Every answer shows its sources, and a click on a source opens the PDF with the quoted sentence highlighted.

Your files stay on your machine. Only the question and the relevant passages are sent to Claude.

![Answer with citations and the cited sentence highlighted in the PDF](docs/images/citation-highlight.jpg)

## Getting started

There are three ways to run the app. All of them need Docker.

| Way | Command | Result |
|---|---|---|
| Docker | `docker compose up --build` | App in the browser |
| Desktop app | `npm install && npm run app` | Same app in its own window |
| Development | `npm install && npm run dev` | Backend and frontend with hot reload |

After the first start, an onboarding asks for language, appearance and your name. Then add your Claude API key under **Settings > Models**. Without a key you can already upload and search; questions then return matching passages instead of an answer.

### Docker

Requires Docker with Compose v2 and about 4 GB of free memory.

```sh
git clone https://github.com/helpful-luca/Siteco.git
cd Siteco
docker compose up --build
```

Open http://localhost:3000.

- The first build takes a few minutes and uses about 3.5 GB of disk (images, virus scanner, embedding model). Later starts take seconds.
- Instead of the settings page, the key can go into a `.env` file: `cp .env.example .env`, set `ANTHROPIC_API_KEY`, run `docker compose up -d`.
- Port 3000 taken: `APP_PORT=3001 docker compose up --build`.
- Stop with `docker compose down`. Documents and chats are kept in Docker volumes.

### Desktop app

Requires Docker and Node 22.12 or newer.

```sh
npm install
npm run app
```

The app starts Docker Desktop if needed, runs the same `docker compose` stack and opens a window. The first start also downloads Electron (about 130 MB). Closing the window leaves the containers running, so the next start is instant. Installers for macOS and Windows: [desktop/README.md](desktop/README.md).

### Development

Requires Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 22.12 or newer, `make` and Docker. Stop the Docker stack first (`docker compose stop`), since both use port 3000.

```sh
npm install
npm run dev
```

This starts the virus scanner in Docker, the backend on port 8000, the Next.js dev server on port 3000 and the desktop window. The first run downloads the embedding model (about 400 MB). A key in `.env` is used here as well.

For scanned PDFs outside Docker, install Tesseract: `brew install tesseract tesseract-lang`.

## Using the app

1. **Upload:** drop files into the library or import a link. Each file is scanned for malware, read and indexed.
2. **Ask:** start a chat. The answer streams in with numbered sources.
3. **Check:** click a source. The PDF opens on that page with the sentence highlighted.
4. **Follow up:** keep asking in the same chat.
5. **Compare:** let two models answer the same question side by side.

Below each answer you find the model, cost, timings and the passages that were used.

<p>
  <img src="docs/images/onboarding-language.jpg" width="32%" alt="Onboarding: language">
  <img src="docs/images/onboarding-appearance.jpg" width="32%" alt="Onboarding: appearance">
  <img src="docs/images/onboarding-name.jpg" width="32%" alt="Onboarding: name">
</p>
<p>
  <img src="docs/images/new-chat.jpg" width="49%" alt="New chat">
  <img src="docs/images/library.jpg" width="49%" alt="Library">
</p>
<p>
  <img src="docs/images/import-link.jpg" width="49%" alt="Import from a link">
  <img src="docs/images/chat-answer.jpg" width="49%" alt="Answer with sources">
</p>

## What is built

| Case brief | Implementation |
|---|---|
| Upload | PDF, TXT, Markdown, HTML; drag and drop or link import; up to 1 GB and 5000 pages per file; ClamAV scan first |
| Process | pypdfium2 in its own process, OCR for scanned pages, sentence-aware chunks of about 400 tokens, local embeddings (IBM Granite), LanceDB |
| Retrieve | Hybrid search: vectors and BM25 with German stemming, combined by rank fusion |
| Answer | Claude with native citations, streamed, with stop, retry and chat history |
| Rich rendering | Markdown with tables and code; tables and code open in a side panel |
| Citation highlighting | Exact line positions in the PDF, passage highlight in text files, OCR word positions for scans |
| Multiple models | Haiku, Sonnet or Opus per message, and a side-by-side comparison |

Also included: German and English UI, light and dark mode, command palette (⌘K or Ctrl K), data export and deletion, desktop app for macOS and Windows.

## Architecture

```
Browser or desktop window (localhost:3000)
  -> Next.js: UI and a streaming proxy for /api
       -> FastAPI (internal network only)
            SQLite    documents, chats, settings
            LanceDB   chunks, vectors, BM25 index
            files     uploaded originals
            embedding model and Tesseract inside the container
       -> ClamAV: scans every upload
  -> Claude API (called by the backend, only with a key)
```

- **Backend:** layers `api`, `services`, `domain` and `adapters`. import-linter checks the boundaries in CI.
- **Frontend:** feature folders; API types are generated from the OpenAPI contract.

More in [docs/architecture.md](docs/architecture.md).

## Key decisions

| Topic | Chosen | Rejected | Why |
|---|---|---|---|
| Citations | Claude `search_result` blocks with native citations | The model writes `[1]` itself | Exact cited sentences; documents stay data, not instructions |
| Retrieval | Hybrid: vectors and BM25 | Vectors only | Finds exact codes like IP66 and works across languages |
| Embeddings | IBM Granite multilingual, local | API embeddings, bge-m3 | Good German, runs offline on CPU, only one API key needed |
| Index | LanceDB embedded, SQLite as source of truth | Qdrant, Chroma | No extra service; search only sees finished documents |
| PDF parsing | pypdfium2 in a separate process | PyMuPDF (AGPL), Docling (needs torch) | Line positions for highlighting; a broken file can be stopped |
| Streaming | Own SSE endpoint and Next.js proxy | Vercel AI SDK, Next.js `rewrites()` | Full control; `rewrites()` buffered the stream |
| Model | Claude Sonnet 5.5, switchable per message | One fixed model | Good quality and cost for reading; cost shown per answer |
| Chunking | Page, paragraph, sentence | Semantic chunking | Sentences are what gets cited and highlighted |
| Answer safety | No images or HTML in answers, strict CSP | Sanitising afterwards | A prompt injection cannot leak data through an image |
| Uploads | One file per request, quarantine until scanned | Multipart, scan later | Size is checked while reading; nothing unscanned is used |

All decisions: [docs/decisions.md](docs/decisions.md).

## Tests

```sh
make test   # backend, frontend and desktop tests
make lint   # linters, type checks, architecture boundaries
make e2e    # browser tests against the Docker stack
```

| Area | Tool | Tests |
|---|---|---|
| Backend | pytest with real SQLite and LanceDB | 944 |
| Frontend | Vitest and Testing Library | 491 |
| Desktop app | Vitest | 113 |
| End to end | Playwright against the Docker stack | 2 runs |

- CI runs all of the above and builds the Docker images on amd64 and arm64.
- Tests replace Claude with a test double, so they never call the paid API.
- `make e2e` needs a browser once: `cd frontend && npx playwright install chromium`.
- Opt-in: `RUN_SLOW=1` parses a 1500-page PDF, `RUN_LIVE=1` makes one real Claude call.

## Configuration

Nothing is required. All options are in [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Claude API key; a key set in the app takes precedence |
| `APP_PORT` | `3000` | Port of the web app |
| `OCR` | `on` | Read scanned pages; `off` skips them |
| `LOG_LEVEL` | `INFO` | Backend log level |

## Security and privacy

- The API key stays in the backend, and the backend is not reachable from outside Docker.
- The API only accepts requests to localhost; changes also need a custom header and the app's own origin.
- Uploads are checked for size and file type, parsed in a separate process and scanned by ClamAV.
- Documents go to Claude as data, never as instructions. Answers cannot load images or run HTML.
- No analytics and no third-party requests. Telemetry of all bundled tools is off.
- Deleting a document removes the file, its vectors and quoted snippets. Automatic deletion after 30, 90 or 365 days can be turned on.

Details and known limits: [docs/security.md](docs/security.md).
