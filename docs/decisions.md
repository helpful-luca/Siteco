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
| 29 | PDF active content | Streaming check in the parse stage: whole name tokens with `#xx` decoding, stream data skipped, object streams inflated (capped at 64 MB) | Grep over the raw file | Compressed object streams hide dictionaries, and random stream bytes contain `/JS` or `/AA`; notices belong to the ingestion pass, so a restart recomputes them |
| 30 | File of a document in `scanning` | `DOCUMENT_NOT_READY` | Serving the quarantined file | Nothing unscanned leaves the backend |

## Measurements

| What | Result |
|---|---|
| Generated 1500-page catalog (6.2 MB, 4401 chunks), fake embedder | 9.1 s end to end on an Apple M4 |
| Same catalog, Granite 97M on 5 of 10 cores | 281 s (about 16 chunks per second) |
| Peak Python memory while ingesting, 150 vs 1500 pages | 6.2 MB vs 7.1 MB |
| clamd first start (signatures in the image, freshclam update included), Apple M4 | about 5 s until PONG; amd64 image under emulation about 8 s |
| clamd memory with all signatures loaded | about 1.0 GB |
| clamd start without network | works with the signatures from the image; freshclam logs a warning |
