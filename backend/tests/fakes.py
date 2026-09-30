"""Test doubles for ports. Deterministic and dependency-free."""

import asyncio
import re
import threading
import time
from collections.abc import Callable, Collection, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

from docchat.domain.chunking import section_from_text
from docchat.domain.errors import IngestionError
from docchat.domain.malware import ScanVerdict
from docchat.domain.models import Chunk
from docchat.domain.parsing import PageBatch, PageBatchFailed, TextSection


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


def page(number: int, text: str) -> TextSection:
    return section_from_text(text, page=number)


class FakePdfParser:
    """Serves scripted pages. `pages` maps a file name to its page texts ("" = scanned page)."""

    def __init__(self) -> None:
        self.pages: dict[str, list[str]] = {}
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
        return PageBatch(sections=tuple(page(first + i + 1, t) for i, t in enumerate(texts)))

    async def close(self) -> None:
        return None


class FakePageOcr:
    """Recognizes scripted page texts (by 1-based page number); None for unknown pages."""

    def __init__(self, texts: dict[int, str] | None = None, *, available: bool = True) -> None:
        self.texts = texts or {}
        self.available = available
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

    def get_chunk(self, document_id: str, chunk_id: str) -> Chunk | None:
        row = self.rows.get(chunk_id)
        return row[0] if row and row[0].document_id == document_id else None

    def count(self, document_id: str) -> int:
        return sum(1 for chunk, _ in self.rows.values() if chunk.document_id == document_id)

    def search(
        self, text: str, vector: Sequence[float], document_ids: Collection[str], limit: int
    ) -> list[Chunk]:
        """Ranks by shared words, then document order: enough to test what surrounds it."""
        self.searches.append((text, tuple(document_ids), limit))
        words = _words(text)
        candidates = [c for c, _ in self.rows.values() if c.document_id in document_ids]
        ranked = sorted(candidates, key=lambda c: (-len(words & _words(c.text)), c.ordinal))
        return ranked[:limit]

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
