# Testing

No test calls the real Claude API and none needs a key: `LLM_PROVIDER=fake` and recorded Claude stream events cover the model side. The one live test file (`backend/tests/live`) only runs with `RUN_LIVE=1` and a key.

| Level | Tool | What it proves | Count |
|---|---|---|---|
| Domain and adapters | pytest | Chunking, sentences, citation mapping, prompt, limits; stream mapping from recorded Claude events, error mapping, pdfium on generated PDFs (hyphenation, rotation, encryption, scans), clamd protocol against a fake clamd, telemetry switches | 261 unit |
| Services | pytest with fakes | Ingestion state machine, queue priority, limits, answer run including stop and disconnect, comparison, retention, workspace export and erasure | 168 |
| Integration | pytest with real SQLite, LanceDB, pdfium, Tesseract | Repositories, vector store, parser, OCR | 79 |
| API | pytest, FastAPI, fake LLM, a real uvicorn for streaming | Every endpoint, SSE format, each error path, internal token, MCP, forensic erasure, prompt injection | 155 |
| Retrieval eval | pytest `-m model` | The default configuration keeps its measured quality (gate in CI) | 32 questions |
| Frontend | Vitest, Testing Library | Stream reducer, citation sentinels in tables and lists, markdown safety (XSS, images, links, injection echo), components, i18n key parity, error catalog | 468 |
| Desktop | Vitest | Startup orchestration, window rules, config | 87 |
| Browser E2E | Playwright | See below | 4 specs |
| Docker | `fresh-clone-test.sh`, CI docker job | Clean clone starts, EICAR rejected, OCR works, chat round trip, backend not exposed | release, CI |

Counts are from `pytest -m "not model" --collect-only` and `vitest run` on 2026-10-01.

## Browser E2E

`frontend/e2e/`, run with `make e2e` (or `scripts/e2e.sh`). It builds the Compose stack in its own project and port (3700), runs the specs twice and tears everything down:

- Fake model (`chat.spec.ts`): upload a PDF generated at test time and wait for Ready; ask and see the streamed answer with a citation chip; click the chip and see the PDF highlight; stop during streaming (`#fake:slow`); a wrong file type shows the error row and adds nothing.
- No key (`no-key.spec.ts`): the question shows the sources card and its Open button opens the PDF panel.

Specs check the stack mode through `/api/health/ready` and skip themselves in the other mode, so `npm run test:e2e` can be pointed at any running stack (`E2E_BASE_URL`). In CI every run records a trace, uploaded as the `playwright-traces` artifact. Locally `E2E_CHANNEL=chrome` uses installed Chrome.

## Security and privacy tests

- EICAR through real clamd ends as `MALWARE_DETECTED` and never reaches `uploads/` (fresh clone script and `tests/docker`).
- Forensic erasure: after deleting a document the disk and the index are searched for its text, vectors and snippets (`tests/api/test_forensic_erasure.py`).
- Prompt injection fixture (`tests/api/test_prompt_injection.py`): a document with "ignore previous instructions", a tracking image and a link reaches the model only inside `search_result` blocks; the echoed answer is stored as text and the markdown test proves nothing in it loads by itself.
- ONNX Runtime telemetry stays off (`test_onnxruntime_telemetry.py`).

## Stability

A flaky test is a bug in the test. The early answer from clamd test used to depend on timing (a connection reset could destroy the answer); the fake server now drains the stream before hanging up, and the file passes 40 runs under CPU load.

## Run everything

    cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports && uv run pytest -m "not model"
    cd frontend && npm run lint && npm run typecheck && npm test
    make eval-gate     # needs the embedding model (make dev-api downloads it)
    make e2e           # needs Docker
    ./scripts/fresh-clone-test.sh && FRESH_ENV=fake ./scripts/fresh-clone-test.sh
