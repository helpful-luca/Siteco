# Decisions

The design choices behind Document Chat, each with the option that was turned down and the reason. The [README](../README.md#key-decisions) lists the ten that matter most; this page has the full set, grouped by topic.

## Architecture and boundaries

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Backend layers | `api`, `services`, `domain` enforced by import-linter; adapters implement ports and only `core/container.py` wires them | One package without rules | Boundaries that CI checks do not erode, and services are tested with fakes |
| Source of truth | SQLite holds documents, chats, preferences and usage; LanceDB is only the index | Qdrant or Chroma as a separate service; status kept in the index | No extra service, and search only sees documents SQLite marks `ready` |
| Answer lifecycle | One asyncio task per answer owns retrieval, model call, retries and the final save; the SSE response only reads its queue | Doing the work inside the SSE generator | Exactly one terminal event and one save, however the client disconnects |

## Ingestion and parsing

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Upload transport | Raw body, one file per request, name in a percent-encoded `X-File-Name` header; cheap checks before reading, magic bytes while streaming | `multipart/form-data` | Starlette spools multipart to disk first; a raw body is counted while reading and stopped at the limit |
| PDF parser | pypdfium2 in one spawned worker process, killed and recreated on timeout, timeouts per batch of 50 pages | PyMuPDF (AGPL), Docling (needs torch), a thread with a global lock | Line rectangles for highlighting, and a hanging PDF can only be stopped in its own process |
| Chunking | Page, paragraph, sentence, about 400 tokens, never across pages or headings, with a context header | Semantic chunking | Sentences are the unit that is cited and highlighted |
| Sentence units in PDFs | Line breaks decided by layout: same column and type size, and the next word would not have fit | Splitting only at punctuation | Spec tables and price lists otherwise become one long "sentence", so a single row cannot be cited |
| HTML files | Standard library `html.parser` with an own extractor; the original is served as `text/plain` | BeautifulSoup, lxml; rendering the page | No new native dependency, and a document is data that must never run script |
| OCR | Tesseract CLI (German and English) page by page in the parser process; pdfium renders a PGM on stdin, TSV out | pytesseract, OCRmyPDF, a vision model | No temp files, word positions for highlighting, and nothing leaves the machine |
| Active content | Streaming scan of the PDF for JavaScript, Launch and actions that open files or send data; shown as a notice | Grep over the raw file; flagging every `/OpenAction`; content disarm | Compressed object streams hide dictionaries, and a catalog that opens on page 1 is not a script |

## Malware scan

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Scan placement | Upload lands in a quarantine folder; a background worker scans it, then moves it into the library | Scanning inside the upload request | clamd needs time after start; the request does not wait and no file skips the scan |
| No off switch | Always on; local development starts clamd from `compose.dev.yaml`, tests inject a fake scanner | A `MALWARE_SCAN=off` setting | A switch that skips the scan is one typo away from production |
| clamd client | INSTREAM over TCP with asyncio streams inside the adapter | `clamd` or `pyclamd` from PyPI | Both are unmaintained and block the event loop; the protocol is a few framing rules |

## Retrieval

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Search | Hybrid: vectors plus BM25 with German stemming, reciprocal rank fusion, plus a literal lookup for codes | Vectors only | Exact product codes like IP66 and cross-language questions both work; each method alone misses one of them |
| Embeddings | IBM Granite 97M multilingual via fastembed (ONNX on CPU), baked into the image | API embeddings, bge-m3 | Strong German, Apache 2.0, CPU friendly, offline, and only one API key needed |
| Follow-ups | Search with the previous question plus the current one | An extra model call to rewrite the question | Deterministic, free and instant; "and its weight?" still finds the product |
| Small scopes | Up to 50k tokens (estimated, then counted) go to Claude in full; larger scopes are searched | Always search; sending whole catalogs to a long-context model | "Summarize this document" works, and a catalog question stays at about 8k input tokens |

## Answering and citations

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Citations | Claude `search_result` blocks with native citations, mapped back by chunk id | The model writes `[1]` itself | Exact cited sentences, and document text stays data instead of instructions |
| Model | Sonnet 5.5 at low effort by default, Haiku 4.5 and Opus 5.5 per message | One hard-wired model | Quality and cost fit reading comprehension; the app shows the cost per answer |
| Retries and timeouts | Own retries only before the first token (two at most, shown as `retrying`); 60 s to first token, 180 s total; SDK retries off | SDK retries and its 10 minute default timeout | Visible and cancellable, never doubled text, and a hanging call ends with a clear error |
| Server-side fallbacks | `fallbacks: "default"` for Sonnet and Opus; the served model is shown as a notice | No fallbacks; silent rerouting | A false positive refusal should not end the answer, and a model switch is never hidden |
| Model comparison | Two answers on one question (lanes a and b); only the kept one goes into later history | A separate comparison table and screen | The same endpoint, reducer and history rules serve both modes |

## Streaming and API

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Transport | Own SSE over POST, read with `eventsource-parser`, through an own Next.js route handler | Vercel AI SDK; `rewrites()`; `EventSource` | Full control; `rewrites()` buffered the stream, and `EventSource` cannot POST |
| Stop | The UI aborts the fetch and calls `POST stop`; the server saves `stopped`, a vanished client counts as `interrupted` | Relying on the client abort alone | Works through proxies, and no answer stays `streaming` |
| Error contract | Stable error codes with status and retryable flag exported into OpenAPI; the UI types a place for every code | Free-text error messages | A new backend code that the UI does not handle fails the type check |
| Rate limits | In-memory sliding window per minute (chat 20, uploads 30), counted after all other checks | slowapi, Redis | One process and one user; a question refused for another reason never uses up the limit |

## Frontend

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Live answers | A store above the routes with a pure reducer per chat and lane, read through `useSyncExternalStore`, deltas batched per frame | Streams owned by the chat page; TanStack Query | Answers keep streaming while you switch chats, and a delta re-renders only its own chat |
| Half-written markdown | A helper closes open code fences and holds back a table until its row is complete | Rendering raw deltas; Streamdown | No flicker between text and table while the answer streams |
| PDF viewer | react-pdf with 64 KB range requests and virtualized pages; pdf.js assets served by the app | The pdf.js viewer app; an iframe | Page 800 of a catalog opens without loading the rest, and nothing comes from a CDN |

## Security and privacy

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Answer rendering | No images, no raw HTML, links only http(s) and mailto; static CSP with `connect-src 'self'` | Sanitizing afterwards; a nonce based CSP | A prompt injection cannot exfiltrate through a rendered image; the App Router needs inline scripts |
| Request guard | Every `/api` request needs a loopback Host; writes also need `X-Requested-With` and a matching Origin | Origin check only | A DNS-rebound page is same-origin and would pass the header checks |
| API key | File under `DATA_DIR/secrets` (mode 0600), checked with a free `count_tokens` call, swapped in without restart | Storing it in SQLite with the preferences | The database is exported and copied; a secret must not travel with it |
| Import from a link | Backend download with its own resolver, connecting to the vetted IP; every redirect re-checked | A deny list on the URL text; an egress proxy | Text checks miss DNS rebinding and redirects; a proxy is one more container |
| Deletion | Cited snippets blanked in stored answers; LanceDB old versions purged, SQLite `secure_delete` and WAL truncate; a test searches the disk | Leaving it to normal compaction | Deleted text otherwise survives in index fragments, free pages and the log |
| Containers | `cap_drop: ALL`, `no-new-privileges`, read-only root and non-root users for backend and frontend; no host port for the backend | Non-root users alone | Defence in depth at no cost in behaviour |

## Desktop app

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Startup | Electron runs `docker compose --file compose.yaml up --detach --build` through `execFile` | A shell command; `up` without `--build` | No shell interpolation, and the containers always run the checked-out code |
| Server identity | Trust `/api/health/live` answering `app: siteco-docchat` | A shared secret or TLS for localhost | Local single-user app; the sandboxed renderer exposes nothing worth faking a server for |
| Window | Frameless on macOS and Windows, window buttons drawn by the page through a small checked bridge | Native title bar and caption buttons | One look on both platforms; the cost is Snap Layouts on hover in Windows |

## Packaging and operations

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Run path | `docker compose up --build`; only the web app is published, on 127.0.0.1 | Host installs of Python, Node, Tesseract and ClamAV | One command on arm64 and amd64, and the backend is reachable only inside the network |
| Scanner image | `clamav/clamav:1.5.4-debian13-slim` with signatures in the image | Alpine tags | Only the Debian tags are multi-arch, and an offline start still has signatures |

## Testing

| Topic | Picked | Rejected | Why |
|---|---|---|---|
| Fake model | `LLM_PROVIDER=fake` cites a real sentence of the best passage; error scenarios by marker | Mocks per test; calling Claude in CI | The whole path runs offline and deterministically in tests, CI and demos |
| Streaming tests | Stop, disconnect and busy lanes run against a real uvicorn server in a thread | Starlette `TestClient` only | The TestClient buffers the whole response, so it cannot observe streaming or a disconnect |
| Browser E2E | Playwright against the real Compose stack, run twice (fake model, then no key) | A mocked backend | The tested thing is the image that reviewers run |
