# Decisions

One line per decision: what we picked, what we rejected, and why. Numbered in the order they were made.

## Ingestion (phase 3)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 1 | Upload transport | Raw body, one file per request, `X-File-Name` percent-encoded | `multipart/form-data` | Starlette spools multipart to disk before the handler runs; with a raw body we count bytes while reading and stop at limit + 1 |
| 2 | Upload checks | Name, size, quota and free disk before reading; magic bytes and NUL bytes while streaming; SHA-256 duplicates after | Opening the PDF in the request | Cheap checks first; everything that opens a PDF runs isolated in the parser process |
| 3 | Duplicate of a failed document | Re-queue the existing document | `409 DUPLICATE_DOCUMENT` | Uploading the same file again is the natural "try again" (annex 10, C6) |
| 4 | Malware seam | `MalwareScanner` port called on the temp file, no-op adapter for now | Scanning inside the worker | The file must stay a temp file until scanned (spec 6.9); ClamAV only swaps the adapter |
| 5 | PDF parser isolation | pypdfium2 in one `ProcessPoolExecutor` worker (spawn), killed and recreated on timeout | Thread plus global lock | pdfium is not thread-safe and a hanging PDF can only be stopped in its own process |
| 6 | Parse timeout | Per batch of 50 pages; a failed batch skips its pages (`PAGES_SKIPPED`), the third one fails the document | One timeout per document | A 1500-page catalog needs more than 60 s in total, and one bad page must not cost the whole file |
| 7 | Highlight geometry | Line rectangles per sentence (`count_rects`), normalized to the CropBox with rotation, computed in the parser process | Storing char boxes | A few rectangles per sentence instead of one box per character; pdfium text pages only exist in that process |
| 8 | Imprecise pages | `precise_highlight = false` when pdfium's text and char list differ | Trusting the offsets | Wrong rectangles are worse than highlighting the page |
| 9 | Hyphenation | Remove pdfium's U+FFFE and U+0002 markers with an offset map back to raw indices | Keeping the markers | "Schutz-art" must be searchable as "Schutzart" and still map to the right characters |
| 10 | Pipeline shape | Two passes: parse into a JSONL chunk spool, then embed from the spool in batches | Holding all chunks in memory | Memory stays flat up to 5000 pages, and `parsing` and `embedding` stay honest statuses |
| 11 | Index writes | Batched `add` (256 chunks), one write lock, `optimize()` after each document | One write per document | Constant memory; readers only see `ready` documents, so partial writes are invisible |
| 12 | Queue order | Priority by page count (estimated from file size until counted), a document is overtaken at most 5 times | FIFO; pure priority; counting pages during upload | A datasheet must not wait behind a catalog, a stream of datasheets must not starve it, and uploads never open PDFs |
| 13 | Status changes | Compare-and-set updates on the status column; delete sets `deleting` and cleans up at once | Locks across stages | Delete always wins; the worker notices at its next progress update and removes what it wrote |
| 14 | Interrupted work | Re-queued on startup, plus a sweep of orphan files, chunks, temp files and spool | `failed PROCESSING_INTERRUPTED` | Annex 11 wins over annex 10; a restart should just continue |
| 15 | Embedding threads | Half the CPU cores for ingestion | All cores | Questions stay fast while a large upload is indexed |
| 16 | Text files | BOM, then strict UTF-8, then cp1252 only if 95 % of the result is printable | Latin-1 as blind fallback | Latin-1 decodes any binary data into garbage |
| 17 | Chunking | Page, then paragraph and sentence, about 400 tokens, never across pages or headings, context header in the embedded text | Semantic chunking | Sentences are the unit that is cited and highlighted |
| 18 | Library list | All documents except `deleting`, newest first | Capping at 50 | The master spec removed the fixed document limit |
| 19 | OCR seam | `PageOcr` port called for pages without a text layer, no-op until phase 5b | Nothing | Tesseract plugs in without touching services |
| 20 | Untrusted text parsing | Only linear regular expressions, headings limited to 500 characters per line | Parsing text files in the parser process | A backtracking pattern on one hostile line could stall the API; linear patterns remove the cause without shipping 50 MB of text between processes |

## Malware scan (phase 3b)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 21 | Scan placement | Row `scanning`, file in `data/quarantine/`, a background scan worker moves it into the library and queues it | Scanning inside the upload request | clamd needs a few seconds (more on slow machines) after start; the request must not wait and the file must never skip the scan |
| 22 | `MALWARE_SCAN=off` | Wires a scanner that always answers clean, so every upload still passes `scanning` | A second upload path without the scan | One code path; `off` is for development only and `/api/config` exposes it for a permanent hint |
| 23 | clamd client | INSTREAM over TCP implemented in the adapter with asyncio streams, answer read while sending | `clamd` or `pyclamd` from PyPI | Both have had no release for years and block the event loop; the protocol is four framing rules |
| 24 | Image | `clamav/clamav:1.5.4-debian13-slim` | `clamav/clamav:1.5` (Alpine) | Only the Debian tags are multi-arch (amd64, arm64); the non-`_base` image ships signatures, so an offline start works and `freshclam` updates when online |
| 25 | Scanner not reachable | Retry with backoff (1 s doubling to 15 s), notice `SCANNER_STARTING`, after 10 minutes `SCANNER_UNAVAILABLE`, never bypassed | Failing the document | A starting scanner is normal; the file just waits |
| 26 | clamd refuses a file | `failed` with `MALWARE_SCAN_FAILED`; files above clamd's `StreamMaxLength` are refused before sending | Retrying forever | The answer will not change, and a dropped connection must not look like an outage |
| 27 | Scan limits | `StreamMaxLength`, `MaxFileSize`, `MaxScanSize` 1100 MB, `MaxScanTime` 600 s, `ConcurrentDatabaseReload no` | clamd defaults (100 MB, 120 s) | Files up to the 1 GB upload limit are scanned completely; one signature copy in memory |
| 28 | Signature name | Stored in a new `error_params` column (schema v2), shown only in the detail | In the error message | Messages are never shown; params are the envelope's place for details |
| 29 | PDF active content | Streaming check in the parse stage, linear in the file size: whole name tokens with `#xx` decoding, streams start only at `>> stream` and their data is skipped, object streams inflated (capped at 64 MB); at 200,000 streams or 30 s it stops and reports the notice anyway | Grep over the raw file | Compressed object streams hide dictionaries, and random stream bytes contain `/JS` or `/AA`; notices belong to the ingestion pass, so a restart recomputes them |
| 30a | Scan worker start | Runs from the first second, independent of the embedding model | Starting it with ingestion | Uploads must not hang in `scanning` because the model is still loading or failed |
| 30b | Unexpected scan errors | `failed` with `MALWARE_SCAN_FAILED` (or `PROCESSING_INTERRUPTED` for a lost file), quarantine emptied | Leaving the row for the next restart | Nothing stays in `scanning` forever |
| 30 | File of a document in `scanning` | `DOCUMENT_NOT_READY` | Serving the quarantined file | Nothing unscanned leaves the backend |

## App shell and library UI (phase 3 UI)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 31 | Upload in the browser | XHR per file, three in parallel, extension and size checked before sending | `fetch` with a stream body | Only XHR reports upload progress; the backend checks everything again |
| 32 | Where uploads live | An upload provider above the routes, a drop anywhere opens the library | Uploads owned by the library page | Uploads keep running while you navigate, and the chat page can start one too |
| 33 | Library columns | Container queries on the table | Viewport breakpoints | The right panel narrows the table on wide screens; columns follow the space they really have |
| 34 | Status polling | TanStack Query polls every second only while a document is scanning, queued, parsing or embedding | Always polling; SSE | Nothing to poll when the library is at rest (annex 11, 2.5) |
| 35 | Desktop title bar | Inline script sets `data-desktop` on `<html>` from `window.desktop`, CSS reserves the space | Detecting Electron in React | No layout jump on first paint; Electron code stays in phase 12 |

## Chat core (phase 4 backend)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 36 | Answer lifecycle | One asyncio task per answer owns retrieval, model call, retries and the final save; the SSE response only reads its queue | Doing the work inside the SSE generator | Exactly one terminal event and one save must not depend on how the web framework finalizes a cancelled generator |
| 37 | Preconditions | Checked in an async FastAPI dependency before the generator route runs | Returning a hand-made `StreamingResponse` | Every refusal stays JSON with a status code (S1) and FastAPI keeps its 15 s keepalive |
| 38 | Stop and disconnect | Stop cancels the task (saved as `stopped`, `done` event); a vanished listener marks it `interrupted`; a stop before the task ran ends it at its first step | Relying on the client abort alone | The stop call is the second safety net for proxy chains; nothing stays `streaming` |
| 39 | Citation offsets | Port events are block level; a pure `AnswerAssembler` places each citation at the end of its text block and maps it by `source` (chunk id) | Offsets in the adapter; `search_result_index` | One tested place for Claude and the fake; the index counts across the whole request (annex 12, 1a) |
| 40 | Retries | Own retry only before the first delta, up to 2 retries with `status: retrying`, backoff with jitter, `retry-after` up to 10 s; SDK `max_retries=0` | SDK retries; retrying after text was sent | Visible and cancellable; annex 11 (2 attempts) wins over annex 10 S7 (one); never doubled text |
| 41 | Server-side fallbacks | `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` for Sonnet 5.5 and Opus 5.5, off for Haiku 4.5 and comparison lanes; served model from `message_start` and `fallback` blocks, notice `MODEL_SWITCHED`, cost per `usage.iterations` entry | No fallbacks (annex 11) | Decision Luca (master spec 12.4); a refusal false positive should not end the answer |
| 42 | SDK surface | `client.beta.messages.create(stream=True)` raw events, one path with or without fallbacks | `messages.stream()` helper | The helper accumulates blocks we ignore (thinking, fallback); raw events are what the adapter tests replay |
| 43 | Timeouts | SDK `Timeout(connect 5, read 60, write 10, pool 5)`; service limits 60 s to the first delta per attempt, counted from `RequestStarted` (after the wait for a free model slot), and 180 s in total | SDK defaults (10 min per attempt); counting queue time as model time | A hanging call must end as `LLM_TIMEOUT`, not after half an hour; waiting behind other answers is not the model's fault |
| 43a | Timeout retry | `LLM_TIMEOUT` is not retried automatically | Retrying like an overload | A second 60 s wait is worse than an immediate error with "try again" and "other model" |
| 44 | Schema v3 | `messages.notices` and `messages.sources_mode` | Deriving them on read | `MODEL_SWITCHED` and the full-context mode cannot be derived later |
| 45 | Regenerate | Reuses the assistant row and id | New row | The UI replaces the answer in place; no orphaned failed answers |
| 46 | Refusal | Partial text and citations discarded, status `refused`, notice `LLM_REFUSED` | Keeping the partial | Mid-stream refusal output is not an answer (S9) |
| 47 | Summary hint | `SUMMARY_PARTIAL` only when the question asks for a summary (DE/EN keywords) and the scope is too large for full context | Always in retrieval mode | Otherwise a notice on nearly every answer |
| 48 | Fake model | `LLM_PROVIDER=fake` cites the first sentence across all sources that reads like one (four words or more, no `#` heading or table row, ends in punctuation; WP-G); scenarios by script (tests) or a `#fake:<name>` marker in the question (E2E) | An environment switch per scenario | E2E needs several error paths in one run; the marker only exists with the fake provider |
| 49 | Streaming tests | Busy lane, stop and disconnect run against a real uvicorn server in a thread | Starlette `TestClient` only | The TestClient buffers the whole response, so it cannot observe streaming or a disconnect |
| 50 | Cost | Prices as constants with source and date; unknown fallback models priced at the requested model | Live prices | There is no pricing API; a new fallback target must never look free |
| 51 | onnxruntime telemetry | `ORT_DISABLE_TELEMETRY=1` set in `docchat/__init__.py` (before anything imports onnxruntime) and in the Dockerfile, plus `disable_telemetry_events()` before the session | `disable_telemetry_events()` alone | onnxruntime 1.30 on macOS runs Microsoft 1DS telemetry (system details, uploads to `mobile.events.data.microsoft.com`) and aborted at exit; measured: only the variable keeps its store untouched |
| 57 | Saving an answer | Only a failed message save changes the outcome (`error`, stage `persist`), followed by one more attempt to mark the row `error`; ledger and chat reload failures are logged, `done` stays | One try block for everything | A bookkeeping hiccup must not turn a complete answer into an error, and no row may stay `streaming` |
| 58 | Deleting during preparation | A stop reaches answers that are reserved but have no task yet; deleting a chat waits until all its answers are released | Checking only running tasks | Otherwise an answer prepared a moment earlier writes into a deleted chat |
| 59 | Documents deleted mid-answer | Retrieval re-reads `ready` ids from SQLite instead of trusting the plan made before the stream | Plan only | SQLite is the truth; a deleted document must never be a source |
| 60 | Question and placeholder | Inserted in one transaction | Two inserts | A failed placeholder would leave the question and block the retry as `DUPLICATE_REQUEST` |

## UI polish (spacing and layout)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 52 | Root font size | Browser default 16 px, body text 15 px on `<body>` | 15 px root | Tailwind spacing is rem based; a 15 px root made every step 3.75 px and nothing sat on the 4 px grid |
| 53 | Control height | One toolbar height of 32 px (md buttons, search, segmented), sm 28 | 36 px md buttons | Controls in one row share a height; 32 is macOS toolbar scale |
| 54 | Touch targets | `pointer-coarse:` grows controls to 44 px | Breakpoint based sizes | The device decides, not the window width; a narrow desktop window keeps desktop density |
| 55 | Control radius | 12 px | 10 px | Concentric with the 24 px sidebar and its 12 px padding |
| 56 | Global banner | Rendered inside the page column by `Page` | Full width above `<main>` | Shares the left edge with title, toolbar and table and scrolls away on phones |

## Chat UI, rich rendering and artifacts (phase 4 UI, phase 10)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 61 | Where answers stream | A `StreamProvider` above the routes: a small external store around a pure reducer keyed by chat and lane, stable actions in context, components subscribe to their own slice (`useSyncExternalStore`); deltas batched per animation frame | Streams owned by the chat page; one context with all runs; TanStack Query | Answers keep streaming while you switch chats, and a delta re-renders only the chat that shows it |
| 62 | Stream reading | `fetch` POST, `eventsource-parser` on the raw bytes, a 45 s watchdog on bytes (pings included) | `EventSource` | `EventSource` cannot POST; the watchdog must see pings, which the parser swallows |
| 63 | Question confirmation | The question stays in the composer until `meta`; the live turn appears only then | Optimistic bubble | A refusal before the stream never loses the typed text (annex 11, 8.2) |
| 64 | Stop | Mark the run stopped, abort the fetch and call `POST stop` together | Waiting for the server's `done` | The UI reacts at once; the server saves `stopped` anyway |
| 65 | Live and saved answers | One `Answer` view model for both; the run is dropped only when the saved answer is loaded | Swapping on `done` | No flicker between the streamed and the saved version |
| 66 | Citation offsets | Python code points mapped to UTF-16 indices; a chip moves before trailing whitespace and into the last table cell; chips in code are dropped, chips in link text move behind the link | Raw offsets | Astral characters and block ends would shift or break chips; no buttons inside anchors or code |
| 67 | Chip line breaks | The last word and its chips are one no-wrap group | Chips as free inline items | A chip never starts a line on its own |
| 68 | Half written markdown | A pure helper closes open fences, holds back a table until its separator row is complete and drops a half row or link | Rendering raw deltas; Streamdown | No flicker between text and table; react-markdown stays safe by default |
| 69 | Links in answers | Only `http`, `https`, `mailto`, opened with `noopener noreferrer nofollow`; everything else becomes text | react-markdown's default URL filter | The default keeps relative and other schemes |
| 70 | Scope and model pickers | In the chat header toolbar, like the approved style screen | A control row inside the composer | Approved look, one-line composer, macOS toolbar pattern |
| 71 | Sources list | Cited sources grouped by document; the other retrieved passages behind a disclosure | All retrieved sources | Less noise, nothing hidden |
| 72 | Artifacts | The right panel in a wide size (600 px) for an answer, a table or a code block; CSV from the syntax tree with formula prefixes defused, semicolon for German | A route; model generated artifacts | The chat stays visible; spreadsheets must not run formulas from documents |
| 73 | Source panel until WP-E | Cited sentence, snippet and "open document" to the sandboxed file endpoint in a new tab, behind `useOpenSource` | A dead button | Useful now, the PDF highlight viewer replaces only the panel body |
| 74 | Sidebar chat list | The chat feature passes its list into the shell as a slot; the search text lives in the UI context | The shell importing the chat feature | No import cycle between shell and chat |
| 75 | Empty first send | A chat is created on the first send and deleted again when the question is refused before the stream | Keeping it | No empty "New chat" rows after a refusal (annex 10, E20) |
| 76 | Scrolling | A new question moves to the top and its turn fills the view; following only near the end, otherwise a jump button; once scrolled, the list's top edge fades out under the header | Always scrolling to the end; a glass header band | Reading position is never stolen (annex 11, 8.3); text never runs into the title |
| 77 | Forged citations | Brackets of sentinel-like text in the answer get an invisible word joiner while our sentinels are inserted between the original slices | Trusting model output | A document quoting `⟦c:1⟧` must not turn into a chip; offsets stay exact |
| 78 | Long streaming answers | Finished blocks (up to the last blank line outside code) render once as memoised pieces, only the tail is parsed each frame; saved turns keep their identity | Parsing the whole answer each frame | Linear instead of quadratic work; a 20k answer parses about twice its length in total |

## Citation highlighting and OCR (phase 5, 5b)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 79 | OCR engine | Tesseract 5.5 (deu+eng) as a CLI: pdfium renders the page (300 dpi, longest side at most 5000 px) into a grayscale PGM on stdin, `tsv` output on stdout | pytesseract with Pillow; OCRmyPDF; a vision model | No Python wrapper and no temp files; the TSV has block, paragraph and line per word, which is all the highlight needs; nothing leaves the machine |
| 80 | Where OCR runs | Page by page in the parser's isolated process (shared with pdfium), timeout per page (`OCR_PAGE_TIMEOUT_S`, default 60) and a process timeout on top; one OpenMP thread | A second process pool; whole batches | pdfium stays in one process; a hanging page costs only that page; questions stay fast during a long OCR run |
| 81 | OCR progress | Status stays `parsing`; notice `OCR_RUNNING {page, pages}` while a scanned page is read, the library shows "Texterkennung" with the page; `PAGES_OCR {count}` at the end, `PAGES_WITHOUT_TEXT` only for pages OCR could not read | A new status `ocr` | A new status means a table rebuild (CHECK constraint) and a state machine change for a sub-stage of parsing |
| 82 | OCR geometry | Words joined per line, lines per paragraph; a sentence gets one rectangle per OCR line (union of its word boxes), normalized to the rendered image, which already has CropBox and rotation applied | Word boxes per sentence | Same shape as text PDFs, so the viewer needs no OCR special case |
| 83 | OCR switch | `OCR=on` (default) or `OCR=off`; a missing binary logs `ocr_unavailable` once and acts like `off`; empty pages skip Tesseract | Failing the start | Local development works without Tesseract; the image always has it (`docchat.cli.ocr_selftest` in the fresh clone test and CI) |
| 84 | Text for TXT/MD viewer | `GET /api/documents/{id}/text` serves the decoded, NFC, LF text the sentence offsets count in | Decoding the raw file in the browser | The raw file may be cp1252, have CRLF or a BOM; one decoder in one place |
| 85 | PDF viewer | react-pdf 11.0.0 (pdfjs-dist 6.3.289) behind a client wrapper with `dynamic(ssr: false)`, worker set next to `<Document>`, `ErrorBoundary` plus `Suspense`; range requests only (`disableAutoFetch`, `disableStream`, 64 KB chunks); cMaps, standard fonts and wasm copied from pdfjs-dist into `public/pdfjs` at build | pdf.js viewer app; an iframe of the file | The same origin serves everything (CSP), nothing is loaded from a CDN, and the viewer is our own UI |
| 86 | Virtualized pages | Own layout math (page heights from the cited page's shape until a page is measured), only pages within 800 px of the viewport mount; the reading position is kept when sizes change; until the first scroll event the column is where the opening jump puts it | react-window; IntersectionObserver on 5000 placeholders | Pure and tested; page 1 of a catalog is never loaded when the answer cites page 800 |
| 87 | Mark look | Percent rectangles over the page, sodium at 55 % with `mix-blend-mode: multiply` on white paper in both themes, a little taller than pdfium's glyph box, warming up line by line in 320 ms without the glow of `lamp-on` | `lamp-on` as is; a glow | A highlighter keeps the ink black; "no glows" (master spec 7) |
| 88 | Which sentences | All cited blocks of the source in this answer (block index = sentence index); a passage that was only retrieved marks the whole chunk | Only the first citation | A chip stands for its source; the union is what the answer relies on |
| 89 | Fallback without geometry | Notice `HIGHLIGHT_UNAVAILABLE` and the chunk text looked up in PDF.js's text layer of the page (whitespace and hyphens ignored, start and end anchors), marked text items escaped; if not found, a sodium frame around the page | Page only; trusting imprecise rectangles | Most imprecise pages still show the right lines; wrong rectangles never |
| 90 | Deleted sources | Chips and source rows of deleted documents open a "Quelle wurde gelöscht" panel; a 404 of chunk or file (deleted meanwhile) ends there too; since WP-G the panel and the chip preview show no text (decision 113) | Opening nothing (annex 10, E13) | The chip still says where the answer came from |
| 91 | Panel width and keyboard | PDFs open the wide panel (600 px); Escape closes the column unless a field, menu or dialog used the key; focus returns to the chip or button that opened it; answer markdown keeps stable renderers so chips are not remounted | 440 px; focus to the composer | At 440 px 11 pt type is about 6 px high; returning focus is the dialog convention |
| 92 | Static CSP | Production pages (not `/api`, whose files keep `sandbox`) get `default-src 'self'`, `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, no `unsafe-eval`; `next dev` gets none | Nonces now | Nonces are phase 13; this already proves the viewer runs without eval |
| 93 | Headings as sentences | Markdown: the heading line (setext underline included) ends in a forced sentence cut; PDF: lines in larger type than the page's body text (pdfium font size, at most 120 characters) get cuts before and after; OCR headings are their own Tesseract paragraph | Changing the sentence regexes | "Technische Daten" was the start of the first cited sentence and got highlighted; documents indexed before keep their chunks |

## Settings, onboarding and privacy (phase 7)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 110 | Preference source | SQLite row is the truth; `locale`, `theme`, `name`, `onboarded` mirrored as cookies; without an `onboarded` cookie the root layout asks the backend once (1.5 s timeout), the client writes the cookies | Cookies only; localStorage | Browser and desktop window show the same values and the first HTML has language, theme and name (annex 11, 5.1) |
| 111 | Before the setup ran | Language and theme stay with the browser (or the running setup); the mirror only writes them once `onboarded` is true; backend unreachable renders as onboarded until the client knows | Backend defaults (`de`, `system`) from the start | An English browser would otherwise flip to German before it could choose |
| 112 | Skipping the setup | Skip and Escape save `onboarded` with the language and theme applied so far; closing the window saves nothing | Defaults on skip | Annex 10 B1 and B2; what you saw live is what you keep |
| 113 | Redaction | Deleting a document blanks `snippet` and `cited_text` of its sources in every stored answer (file name, page and chip position stay); reads mask sources of missing documents too, and startup redacts leftovers | Keeping the snapshot readable (WP-E) | Master spec 10b, 4 wins over 6.3; the read mask covers an answer saved while its source was being deleted |
| 114 | Delete everything | Stop all answers and wait, delete chats, delete every document through the normal purge, sweep files, quarantine and index against the rows that remain, optional preference reset, `VACUUM`; the usage ledger stays | `rm -rf /data`; `409 CHAT_BUSY` while answers run | Same code path as single deletes; an upload arriving meanwhile keeps its file; costs of the day stay honest (annex 11) |
| 115 | Confirmation | Dialog names the counts, says it is final, Cancel first with focus, reset as a separate switch | Typing a word to confirm | Apple pattern; the counts make the consequence concrete without a chore |
| 116 | Export | ZIP built in a worker thread into a spooled temp file (memory up to 8 MB), streamed in 64 KB chunks: `preferences.json`, `documents.json`, `chats/NNN-slug.json` and `.md`; ASCII slugs, no document files | Including originals | The library can hold 20 GB; the originals are the user's own files already |
| 117 | Retention | `RETENTION_DAYS` (0 off), hourly sweep; chats by last change, documents by upload; a chat with a running answer waits; shown read-only in Settings | A setting in the UI | Master spec 10b, 6 names the env variable; an operator decision, not a per-window preference |
| 118 | Name | Controls, zero width space, bidi marks and overrides removed, joiners kept (emoji sequences), at most 40 code points without cutting a grapheme (client) or a combining mark (server) | 40 UTF-16 units | Annex 10 B8 to B10; client and backend agree on the limit |
| 119 | Settings layout | One route, `?section=`; container query: section list and content side by side, below 672 px iOS style list then detail with a back link; grouped inset cards with hairlines from the text | A dialog; tabs | macOS System Settings and iOS Settings; deep links from notices |
| 120 | Answer mode | Effort from the settings is sent only for models that have efforts; style always | Sending effort to Haiku | Haiku rejects effort (annex 12, 1a); the settings hide the mode for it |

## Measurements

| What | Result |
|---|---|
| Generated 1500-page catalog (6.2 MB, 4401 chunks), fake embedder | 9.1 s end to end on an Apple M4 |
| Same catalog, Granite 97M on 5 of 10 cores | 281 s (about 16 chunks per second) |
| Peak Python memory while ingesting, 150 vs 1500 pages | 6.2 MB vs 7.1 MB |
| clamd first start (signatures in the image, freshclam update included), Apple M4 | about 5 s until PONG; amd64 image under emulation about 8 s |
| clamd memory with all signatures loaded | about 1.0 GB |
| clamd start without network | works with the signatures from the image; freshclam logs a warning |
| OCR of a dense A4 page (300 dpi, deu+eng, one thread), Apple M4 in Docker | about 0.8 s |
| Backend image growth from Tesseract with deu and eng | about 110 MB on disk, 42 MB compressed |
| Chip click to marked sentence, 78 MB generated catalog (240 pages, flat page tree, 360 KB image per page), cited page 150, production build, Apple M4 | 1.3 s; 15 MB of 78 MB fetched by range requests (PDF.js reads every page dictionary of a flat top-level page tree, one 64 KB chunk each) |

## Errors and limits (phase 6)

| # | Topic | Pick | Rejected | Reason |
|---|---|---|---|---|
| 94 | Own rate limits | `services/limits.py`: sliding window per scope in memory with a monotonic clock port, chat 20 and uploads 30 per minute (`RATE_CHAT_PER_MIN`, `RATE_UPLOAD_PER_MIN`, 0 is off), `acquire(cost)` all or nothing for a later comparison | slowapi; a token bucket; Redis | One process and one user; a restart only resets a minute; the cost parameter lets a comparison count as 2 without a half comparison |
| 95 | When a question counts | After every other check and after the lane is reserved; a refusal releases the lane again | Counting at the door | A question refused for another reason (no documents, busy lane) never uses up the limit |
| 96 | When an upload counts | After name, size, quota and free disk, before the body is read | Before any check | An unsupported file costs nothing; the body of a refused upload is never read |
| 97 | Our 429 vs Claude's | `RATE_LIMITED` 429 with `Retry-After` and `params.seconds`; Claude's limit stays `LLM_RATE_LIMITED` as 503 inside the stream | One code for both | You can wait out your own limit; Claude's account limit is not about you (annex 10, I7) |
| 97a | Daily budget | Moved into `limits.py`, still off unless `DAILY_BUDGET_USD`; `/api/config.budget` reports spent, exceeded and reset time for the banner | A separate budget endpoint | The UI reloads config when an answer reveals a change anyway |
| 98 | Model gone at runtime | Claude answering `not_found_error` (not a bare 404) marks the model unavailable for 10 minutes; `/api/config` reports it, new questions with it are refused before the stream with `MODEL_UNAVAILABLE` and `params.fallback`, the picker falls back to the default or the first available model | Silent rerouting; until restart | Annex 10, B15: no silent model switch; a short outage of one model heals by itself |
| 99 | JSON body limit | 64 KB in the backend (declared length, then counted while reading) and in the proxy, raw upload exempt; `REQUEST_TOO_LARGE` 413 | Only Pydantic lengths | Pydantic sees the body only after it was read completely (annex 10, P5) |
| 100 | Error catalog | Status and retryable per code exported into the contract (`x-error-specs`); `frontend/src/shared/api/error-catalog.ts` types the place of every code; a vitest generates and checks `docs/errors.md` | A hand-written table | The table cannot drift from `domain/errors.py` (contract drift test) nor from the UI (compile error for an unplaced code) |
| 101 | Error id after reload | `messages.error_request_id` (schema v4) keeps the request id of a failed answer | Only in the live stream | "Fehler-ID kopieren" is most useful after a reload, when you report it |
| 102 | Backend state in the UI | A module store fed by every request (fetch, stream, upload): connection errors mark it down, any backend answer marks it up, a cut stream only asks for a check; a watcher checks with 1, 2, 5, 10 s pauses, every 10 s while up, and refetches all queries on recovery | `navigator.onLine`; a health poll alone | The app runs on this machine, so the browser's online flag says nothing about it; requests notice first, the heartbeat covers idle screens |
| 103 | Browser offline | Own banner "Du bist offline", library and search keep working; TanStack Query `networkMode: 'always'` | TanStack's default network mode | Its default pauses every query offline, which would stop a local app for no reason |
| 104 | Where an outage shows | Global banner in the page column; in chat views once, as the composer note with "Jetzt versuchen", send disabled, draft kept | Banner and note together | Said once, where the question waits |
| 105 | Countdown | `useCountdown` reads whole seconds from a 250 ms check; `Countdown` shows the seconds `aria-hidden` and fills a polite live region only at start and end; composer and upload rows wait, the queue pauses, retry after the end | Announcing every second | Annex 11, 6.3; screen readers hear two sentences, not sixty |
| 106 | Answer error actions | Overload, timeout, Claude down: "Mit anderem Modell versuchen" (default, else the first other available model); model gone or forbidden: "Anderes Modell wählen" opens the picker; context too large: "Neuen Chat starten"; Claude's 429: retry after its countdown; retries wait while the backend is away | One generic retry | The step that helps, in the place of the error |
| 107 | Startup gate | "Die App startet" for the first 30 s without an answer, only then "nicht erreichbar" | Unreachable at once | The backend loads the search model before it listens; the proxy cannot reach it meanwhile |
| 108 | Route errors | `(app)/error.tsx` keeps the shell and shows the calm screen with retry and the digest as error id; `global-error.tsx` has the same look with inline styles and the locale cookie | Next's default screens | No stack traces, a way back, both themes |
| 109 | Flaky backend test | `test_deleting_a_chat_during_preparation_waits_for_it` slept 50 ms and assumed the preparation thread had reserved the lane; now events hold the preparation, polls use a 10 s hang guard, TTFT and slow-stream windows are wider | Retrying flaky tests | Reproduced by a 60 ms slower SQLite lookup; 45 loops green after the fix (20 under full CPU load) |
