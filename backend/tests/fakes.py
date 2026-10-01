"""Test doubles for ports. Deterministic and dependency-free."""

import asyncio
import re
import threading
import time
from collections.abc import AsyncIterator, Callable, Collection, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from docchat.domain.api_key import KeyCheck
from docchat.domain.chunking import section_from_text
from docchat.domain.errors import AppError, ErrorCode, IngestionError
from docchat.domain.malware import ScanVerdict
from docchat.domain.models import Chunk
from docchat.domain.parsing import PageBatch, PageBatchFailed, TextSection
from docchat.domain.url_import import FetchedResponse, ParsedUrl


class FakeEmbedder:
    """Vector depends only on text length, so tests are deterministic."""

    def __init__(
        self,
        dim: int = 384,
        *,
        fail: bool = False,
        delay_s: float = 0.0,
        fail_on_call: int | None = None,
    ) -> None:
        self.dim = dim
        self.fail = fail
        self.delay_s = delay_s
        self.fail_on_call = fail_on_call
        self.calls = 0
        self.gate: threading.Event | None = None  # set by tests to pause embedding

    def load(self) -> None:
        time.sleep(self.delay_s)
        if self.fail:
            raise RuntimeError("model files missing")

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls += 1
        if self.gate is not None:
            self.gate.wait(timeout=10)
        if self.fail_on_call is not None and self.calls >= self.fail_on_call:
            raise RuntimeError("embedding failed")
        return [self.embed_query(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return [float(len(text) % 7)] * self.dim


class FakeClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.current += timedelta(milliseconds=1)
        return self.current


class FakeTicker:
    """Monotonic seconds that only move when a test says so."""

    def __init__(self) -> None:
        self.current = 1000.0

    def monotonic(self) -> float:
        return self.current

    def advance(self, seconds: float) -> None:
        self.current += seconds


def page(number: int, text: str, heading: str = "") -> TextSection:
    return section_from_text(text, page=number, heading=heading)


class FakePdfParser:
    """Serves scripted pages. `pages` maps a file name to its page texts ("" = scanned page)."""

    def __init__(self) -> None:
        self.pages: dict[str, list[str]] = {}
        self.titles: dict[str, dict[int, str]] = {}  # file name -> page -> title
        self.open_error: dict[str, IngestionError] = {}
        self.failing_batches: dict[str, dict[int, bool]] = {}  # first page index -> timed out
        self.calls: list[tuple[str, int, int]] = []
        self.before_batch: Callable[[str, int], object] | None = None

    async def count_pages(self, path: Path) -> int:
        if path.name in self.open_error:
            raise self.open_error[path.name]
        return len(self.pages[path.name])

    async def parse_pages(self, path: Path, first: int, count: int) -> PageBatch:
        self.calls.append((path.name, first, count))
        if self.before_batch is not None:
            result = self.before_batch(path.name, first)
            if asyncio.iscoroutine(result):
                await result
        failing = self.failing_batches.get(path.name, {})
        if first in failing:
            raise PageBatchFailed(timed_out=failing[first])
        texts = self.pages[path.name][first : first + count]
        titles = self.titles.get(path.name, {})
        return PageBatch(
            sections=tuple(
                page(first + i + 1, t, titles.get(first + i + 1, "")) for i, t in enumerate(texts)
            )
        )

    async def close(self) -> None:
        return None


class FakePageOcr:
    """Recognizes scripted page texts (by 1-based page number); None for unknown pages."""

    def __init__(self, texts: dict[int, str] | None = None, *, available: bool = True) -> None:
        self.texts = texts or {}
        self.available = available
        self.engine_missing = False
        self.calls: list[int] = []
        self.during: Callable[[int], object] | None = None  # runs while a page is recognized

    async def recognize(self, path: Path, page_number: int) -> TextSection | None:
        self.calls.append(page_number)
        if self.during is not None:
            result = self.during(page_number)
            if asyncio.iscoroutine(result):
                await result
        text = self.texts.get(page_number)
        return None if text is None else page(page_number, text)


def _words(text: str) -> set[str]:
    return set(re.findall(r"\w+", text.casefold()))


class FakeVectorStore:
    def __init__(self) -> None:
        self.rows: dict[str, tuple[Chunk, list[float]]] = {}
        self.optimized = 0
        self.purged = 0
        self.dim = 0
        self.searches: list[tuple[str, tuple[str, ...], int]] = []

    def open(self, dim: int) -> None:
        self.dim = dim

    def ping(self) -> bool:
        return True

    def add(self, chunks: Sequence[Chunk], vectors: Sequence[Sequence[float]]) -> None:
        for chunk, vector in zip(chunks, vectors, strict=True):
            self.rows[chunk.chunk_id] = (chunk, list(vector))

    def delete_document(self, document_id: str) -> None:
        self.rows = {k: v for k, v in self.rows.items() if v[0].document_id != document_id}

    def delete_documents_except(self, keep: Collection[str]) -> None:
        self.rows = {k: v for k, v in self.rows.items() if v[0].document_id in keep}

    def optimize(self) -> None:
        self.optimized += 1

    def purge_deleted(self) -> None:
        self.purged += 1

    def get_chunk(self, document_id: str, chunk_id: str) -> Chunk | None:
        row = self.rows.get(chunk_id)
        return row[0] if row and row[0].document_id == document_id else None

    def count(self, document_id: str) -> int:
        return sum(1 for chunk, _ in self.rows.values() if chunk.document_id == document_id)

    def search(
        self,
        text: str,
        vector: Sequence[float],
        document_ids: Collection[str],
        limit: int,
    ) -> list[Chunk]:
        """Ranks by shared words, then document order: enough to test what surrounds it."""
        self.searches.append((text, tuple(document_ids), limit))
        words = _words(text)
        candidates = [c for c, _ in self.rows.values() if c.document_id in document_ids]
        ranked = sorted(candidates, key=lambda c: (-len(words & _words(c.text)), c.ordinal))
        return ranked[:limit]

    def chunks_of_pages(self, document_ids: Collection[str], pages: Collection[int]) -> list[Chunk]:
        order = {d: i for i, d in enumerate(document_ids)}
        chunks = [
            c for c, _ in self.rows.values() if c.document_id in order and c.page in set(pages)
        ]
        return sorted(chunks, key=lambda c: (order[c.document_id], c.page or 0, c.ordinal))

    def find_text(self, term: str, document_ids: Collection[str], limit: int) -> list[Chunk]:
        found = [
            c
            for c, _ in self.rows.values()
            if c.document_id in document_ids and term.lower() in c.text.lower()
        ]
        return sorted(found, key=lambda c: c.ordinal)[:limit]

    def chunks_of(self, document_ids: Collection[str]) -> list[Chunk]:
        order = {d: i for i, d in enumerate(document_ids)}
        chunks = [c for c, _ in self.rows.values() if c.document_id in order]
        return sorted(chunks, key=lambda c: (order[c.document_id], c.ordinal))


class FakeScanner:
    """Answers from a script (a verdict or an exception per call), then says clean."""

    def __init__(self, *script: ScanVerdict | Exception) -> None:
        self.script = list(script)
        self.scanned: list[Path] = []
        self.contents: list[bytes] = []

    async def scan(self, path: Path) -> ScanVerdict:
        self.scanned.append(path)
        self.contents.append(path.read_bytes())
        outcome = self.script.pop(0) if self.script else ScanVerdict()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeSleep:
    """Records waits instead of sleeping; `on_sleep` lets a test act between retries."""

    def __init__(self) -> None:
        self.waits: list[float] = []
        self.on_sleep: Callable[[int], None] | None = None

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)
        if self.on_sleep is not None:
            self.on_sleep(len(self.waits))
        await asyncio.sleep(0)


class FakeKeyValidator:
    """Answers key checks from a table (unknown keys are valid); records what was checked.
    A key that needs a workspace is valid once a workspace id comes with it."""

    def __init__(self, verdicts: dict[str, KeyCheck] | None = None) -> None:
        self.verdicts = verdicts or {}
        self.checked: list[str] = []
        self.workspaces: list[str | None] = []

    async def check(self, key: str, workspace_id: str | None = None) -> KeyCheck:
        self.checked.append(key)
        self.workspaces.append(workspace_id)
        verdict = self.verdicts.get(key, KeyCheck.VALID)
        if verdict is KeyCheck.NEEDS_WORKSPACE and workspace_id:
            return KeyCheck.VALID
        return verdict


class FakeResolver:
    """DNS from a table; records every lookup. Unknown names do not resolve."""

    def __init__(self, table: dict[str, list[str]]) -> None:
        self.table = table
        self.lookups: list[str] = []

    async def resolve(self, host: str, port: int) -> list[str]:
        self.lookups.append(host)
        if host not in self.table:
            raise AppError(ErrorCode.URL_UNREACHABLE)
        return list(self.table[host])


class FakeFetcher:
    """Answers by URL with (status, headers, body chunks); records (url, address) per request."""

    def __init__(self, routes: dict[str, tuple[int, dict[str, str], list[bytes]]]) -> None:
        self.routes = routes
        self.requests: list[tuple[str, str]] = []

    @asynccontextmanager
    async def open(self, url: ParsedUrl, address: str) -> AsyncIterator[FetchedResponse]:
        self.requests.append((url.text, address))
        if url.text not in self.routes:
            raise AppError(ErrorCode.URL_UNREACHABLE)
        status, headers, chunks = self.routes[url.text]

        async def body() -> AsyncIterator[bytes]:
            for chunk in chunks:
                await asyncio.sleep(0)
                yield chunk

        yield FetchedResponse(status, {k.lower(): v for k, v in headers.items()}, body())
