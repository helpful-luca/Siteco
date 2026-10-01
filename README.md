# Document Chat

[![CI](https://github.com/helpful-luca/Siteco/actions/workflows/ci.yml/badge.svg)](https://github.com/helpful-luca/Siteco/actions/workflows/ci.yml)

Upload PDFs, text, Markdown or HTML files and ask questions about them in German or English. Answers stream in, and every claim links to the sentence it comes from, highlighted in the original PDF. Parsing, OCR, the malware scan, embeddings and search run on your machine; only the question and the best passages are sent to Claude.

![Answer with citations and the cited sentence highlighted in the PDF](docs/images/citation-highlight.jpg)

## Run with Docker

You need Docker with Compose v2 and about 4 GB of free memory.

```sh
git clone https://github.com/helpful-luca/Siteco.git
cd Siteco
docker compose up --build
```

Open http://localhost:3000. The first build downloads about 3 GB (images, the virus scanner and the local embedding model) and takes a few minutes. Later starts take seconds.

**Add a Claude API key**, either way works:

- In the app: Settings > Models. The key is checked and used from the next question, no restart.
- In a file: `cp .env.example .env`, set `ANTHROPIC_API_KEY`, then run `docker compose up -d`.

Without a key the app still works: upload and search are available, and a question returns the matching passages instead of an answer. With `LLM_PROVIDER=fake` in `.env`, a built-in stand-in answers with real citations, so the whole flow can be tried without any key.

If port 3000 is taken, start with `APP_PORT=3001 docker compose up --build`. Stop with `docker compose down`; your documents and chats stay in Docker volumes.

## Run locally with npm

For development, the backend and the web app run on your machine with hot reload, inside the desktop window.

You need Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 24, `make` and Docker (only for the virus scanner). Stop the Docker stack first, since both use port 3000.

```sh
npm install
npm run dev
```

This starts the virus scanner in Docker, the FastAPI backend on 127.0.0.1:8000, the Next.js dev server on http://localhost:3000 and the Electron window. The first run downloads the embedding model (about 400 MB) and Electron (about 130 MB).

Scanned PDFs need Tesseract outside Docker: `brew install tesseract tesseract-lang` on macOS. Without it, pages without a text layer are marked as not searchable.

To use the app as a desktop window on top of the Docker stack instead, run `npm run app`. Building an installer for macOS or Windows is described in [desktop/README.md](desktop/README.md).

## How to use it

1. **Library:** drop in files or import a link. The status goes from "Checking" (malware scan) to "Reading" to "Ready".
2. **Ask:** start a chat and ask a question. The answer streams in with numbered citations.
3. **Check the source:** click a citation. The PDF opens on that page with the sentence highlighted.
4. **Follow up:** ask again in the same chat; the previous question is used for the search.
5. **Details:** under each answer you see the model, tokens, cost, timings and the passages that were sent.
6. **Compare:** let two models answer the same question side by side.

| | |
|---|---|
| ![Library](docs/images/library.jpg) | ![Import from a link](docs/images/import-link.jpg) |
| ![New chat](docs/images/new-chat.jpg) | ![Answer with citations](docs/images/chat-answer.jpg) |
| ![Onboarding: language](docs/images/onboarding-language.jpg) | ![Onboarding: appearance](docs/images/onboarding-appearance.jpg) |

## What is built

| Case brief | Implementation |
|---|---|
| Upload | Drag and drop or link import (with SSRF protection); PDF, TXT, Markdown, HTML; up to 1 GB and 5000 pages per file; OCR for scanned pages; ClamAV scan before anything is stored |
| Process | pypdfium2 in its own process with timeouts; sentence-aware chunks of about 400 tokens that never cross pages; local multilingual embeddings (IBM Granite); LanceDB with vectors and BM25 |
| Retrieve | Hybrid search (vectors and BM25 with German stemming, reciprocal rank fusion), a cap per document, per-chat document scope |
| Answer | Claude with `search_result` blocks and native citations, streamed over SSE, with stop, retry and chat history |
| Rich rendering | Markdown with tables and code; tables and code open in a side panel. No raw HTML or images in answers |
| Citation highlighting | Exact line rectangles in the PDF; text files highlight the passage; scanned pages use OCR word positions |
| Multiple models | Model per message (Haiku, Sonnet, Opus) and a side-by-side comparison with timings and cost |

Also included: German and English UI, onboarding, light and dark mode, a command palette (⌘K or Ctrl K), settings, export and deletion of all data, and a desktop app for macOS and Windows.

## Architecture

```
Browser or desktop window (localhost:3000)
  -> Next.js container: UI and a streaming proxy for /api
       -> FastAPI container (internal network only)
            SQLite    documents, chats, messages, settings, usage
            LanceDB   chunks, vectors, BM25 index
            files     uploaded originals
            embeddings and Tesseract run inside the container
       -> ClamAV container: scans every upload
  -> Anthropic API (only with a key, called by the backend)
```

The backend is layered: `api` (HTTP), `services` (use cases), `domain` (rules and ports) and `adapters` (SQLite, LanceDB, Claude, ClamAV and so on). import-linter enforces the boundaries in CI. The frontend is organised in feature folders, and its API types are generated from the OpenAPI contract. More in [docs/architecture.md](docs/architecture.md).

## Key decisions

| Topic | Chosen | Rejected | Why |
|---|---|---|---|
| Citations | Claude `search_result` blocks with native citations | The model writes `[1]` itself | Exact cited sentences, and documents stay data rather than instructions |
| Retrieval | Hybrid: vectors and BM25 with rank fusion | Vectors only | Exact codes like IP66 and cross-language questions both work |
| Embeddings | IBM Granite multilingual, local | API embeddings, bge-m3 | Good German, Apache 2.0, runs on CPU, offline, one key is enough |
| Index | LanceDB embedded, SQLite as source of truth | Qdrant, Chroma | No extra service; search only sees documents marked ready |
| PDF parsing | pypdfium2 in a separate process | PyMuPDF (AGPL), Docling (needs torch) | Line positions for highlighting, and a hostile file can be killed |
| Streaming | Own SSE endpoint and Next.js proxy | Vercel AI SDK, Next.js `rewrites()` | Full control; `rewrites()` buffered the stream |
| Model | Claude Sonnet 5.5 by default, switchable per message | One fixed model | Good quality and cost for reading tasks; cost is shown per answer |
| Chunking | Page, paragraph, sentence, with a context header | Semantic chunking | Sentences are the unit that is cited and highlighted |
| Answer safety | No images or HTML, only http(s) and mailto links, static CSP | Sanitising afterwards | A prompt injection cannot leak data through a rendered image |
| Uploads | Raw body per file, quarantine until ClamAV reports clean | Multipart, scan later | Size is enforced while reading; nothing unscanned is ever served |

All decisions: [docs/decisions.md](docs/decisions.md).

## Tests

```sh
make test   # backend, frontend and desktop unit tests
make lint   # ruff, mypy, import-linter, ESLint and TypeScript
make e2e    # browser tests against the Docker stack (needs: cd frontend && npx playwright install chromium)
```

| Area | Tool | Tests |
|---|---|---|
| Backend: domain, adapters, services, API | pytest with real SQLite and LanceDB, a fake embedder and a fake model | 944 |
| Frontend: streaming, citations, markdown safety, components | Vitest and Testing Library | 491 |
| Desktop app | Vitest | 113 |
| End to end | Playwright against the Docker stack, with the fake model and without a key | 2 runs |

CI runs all of the above plus the Docker build on amd64 and arm64. No test calls the paid API. Two opt-in suites exist: `RUN_SLOW=1` parses a 1500-page PDF, `RUN_LIVE=1` makes one real Claude call.

## Configuration

Nothing is required. All variables are listed in [.env.example](.env.example); the common ones:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Claude API key, read only by the backend. A key set in the app takes precedence |
| `APP_PORT` | `3000` | Port of the web app |
| `LLM_PROVIDER` | `anthropic` | `fake` answers without Claude, for tests and demos |
| `OCR` | `on` | Read scanned pages with Tesseract; `off` skips them |
| `LOG_LEVEL` | `INFO` | Backend log level |

## Security and privacy

- The API key stays in the backend. The backend has no host port, and every API request must be addressed to localhost; requests that change data also need a custom header and a matching origin.
- Uploads are checked by size and file signature, parsed in a separate process with timeouts and scanned by ClamAV before they are used.
- Documents are passed to Claude as data, never as instructions. Answers cannot load images or run HTML.
- Only the question and the selected passages leave the machine. No analytics, no third-party requests in the browser, telemetry of all bundled tools turned off.
- Deleting a document removes the file, its vectors and quoted snippets. Chats can be exported, and automatic deletion after 30, 90 or 365 days can be turned on.

Details and known limits: [docs/security.md](docs/security.md).

## Next steps

1. A retrieval evaluation set with numbers, then a reranker if it shows the right passage is often not ranked first.
2. Summaries of whole large documents (today an answer says when it only saw the relevant parts).
3. Login and separate libraries per user, then a server deployment.
4. EU-hosted inference, for example Claude on AWS Bedrock in Frankfurt.
5. Signed desktop builds with automatic updates.

## How I worked with AI

I built this with Claude Code as pair programmer and reviewer. It wrote most of the code, test first. The decisions, the scope and the verification were mine: I chose the stack and the trade-offs, dropped what did not hold up (for example `rewrites()` for streaming, PyMuPDF, a fixed model), and checked the results by running the app and reading logs rather than trusting green tests.
