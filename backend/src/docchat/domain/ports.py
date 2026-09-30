"""Capabilities the services depend on. Adapters implement them.

Blocking ports are plain methods; services call them via asyncio.to_thread. Ports that manage
their own worker process are async.
"""

from collections.abc import Collection, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Protocol

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import ErrorCode
from docchat.domain.malware import ScanVerdict
from docchat.domain.models import Chunk, Document, Notice
from docchat.domain.parsing import PageBatch, TextContent, TextSection


class Clock(Protocol):
    def now(self) -> datetime: ...


class Embedder(Protocol):
    dim: int

    def load(self) -> None: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class DocumentRepository(Protocol):
    """Every status change is a compare-and-set: it returns False if the row moved on (deleted)."""

    def insert(self, document: Document) -> None: ...

    def get(self, document_id: str) -> Document | None: ...

    def list_visible(self) -> list[Document]: ...

    def list_by_status(self, *statuses: DocumentStatus) -> list[Document]: ...

    def find_by_sha256(self, sha256: str) -> Document | None: ...

    def total_size_bytes(self) -> int: ...

    def all_ids(self) -> set[str]: ...

    def requeue(self, document_id: str, now: datetime) -> bool: ...

    def rescan(self, document_id: str, now: datetime) -> bool:
        """`failed` back to `scanning`, for the same file uploaded again."""
        ...

    def set_notices(
        self, document_id: str, status: DocumentStatus, notices: Sequence[Notice], now: datetime
    ) -> bool: ...

    def finish_scan(self, document_id: str, now: datetime) -> bool:
        """`scanning` to `queued`: the file passed the malware scan."""
        ...

    def start_parsing(self, document_id: str, now: datetime) -> bool: ...

    def set_progress(
        self,
        document_id: str,
        status: DocumentStatus,
        progress: float,
        now: datetime,
        *,
        page_count: int | None = None,
    ) -> bool: ...

    def start_embedding(
        self,
        document_id: str,
        now: datetime,
        *,
        page_count: int | None,
        chunk_count: int,
        char_count: int,
        notices: Sequence[Notice],
    ) -> bool: ...

    def mark_ready(self, document_id: str, now: datetime) -> bool: ...

    def mark_failed(
        self,
        document_id: str,
        code: ErrorCode,
        now: datetime,
        params: Mapping[str, int | str] | None = None,
    ) -> bool: ...

    def mark_deleting(self, document_id: str, now: datetime) -> Document | None: ...

    def delete(self, document_id: str) -> None: ...


class IngestionScheduler(Protocol):
    """The background ingestion queue as the upload and library use cases see it."""

    def enqueue(self, document: Document) -> None: ...

    def forget(self, document_id: str) -> None: ...

    def queue_positions(self) -> dict[str, int]: ...


class ScanScheduler(Protocol):
    """The malware scan queue as the upload use case sees it."""

    def enqueue(self, document: Document) -> None: ...


class UploadSink(Protocol):
    """A temp file that receives an upload. It becomes a library file only via commit()."""

    @property
    def path(self) -> Path: ...

    def write(self, data: bytes) -> None: ...

    def close(self) -> None: ...

    def discard(self) -> None: ...


class FileStorage(Protocol):
    def new_upload(self) -> UploadSink: ...

    def commit(self, sink: UploadSink, document_id: str, kind: DocumentKind) -> None: ...

    def path_for(self, document_id: str, kind: DocumentKind) -> Path: ...

    def exists(self, document_id: str, kind: DocumentKind) -> bool: ...

    # Quarantine: uploads wait here, outside the library, until the malware scan passed.
    def quarantine(self, sink: UploadSink, document_id: str, kind: DocumentKind) -> None: ...

    def quarantined_path(self, document_id: str, kind: DocumentKind) -> Path: ...

    def is_quarantined(self, document_id: str, kind: DocumentKind) -> bool: ...

    def release(self, document_id: str, kind: DocumentKind) -> None:
        """Moves a scanned file from the quarantine into the library."""
        ...

    def discard_quarantined(self, document_id: str, kind: DocumentKind) -> None: ...

    def discard_quarantined_except(self, keep: Collection[str]) -> int: ...

    def delete(self, document_id: str, kind: DocumentKind) -> None: ...

    def delete_except(self, keep: Collection[str]) -> int: ...

    def clear_temp(self) -> None: ...

    def free_bytes(self) -> int: ...


class SpoolWriter(Protocol):
    def write(self, chunks: Sequence[Chunk]) -> None: ...

    def close(self) -> None: ...


class SpoolReader(Protocol):
    def read(self, max_chunks: int) -> list[Chunk]: ...

    def close(self) -> None: ...


class ChunkSpool(Protocol):
    """Chunks between the parse and the embed pass, on disk so memory stays flat."""

    def writer(self, document_id: str) -> SpoolWriter: ...

    def reader(self, document_id: str) -> SpoolReader: ...

    def discard(self, document_id: str) -> None: ...

    def clear(self) -> None: ...


class VectorStore(Protocol):
    """Search index. Writes are serialized by the adapter (one writer per process)."""

    def open(self, dim: int) -> None: ...

    def ping(self) -> bool: ...

    def add(self, chunks: Sequence[Chunk], vectors: Sequence[Sequence[float]]) -> None: ...

    def delete_document(self, document_id: str) -> None: ...

    def delete_documents_except(self, keep: Collection[str]) -> None: ...

    def optimize(self) -> None: ...

    def get_chunk(self, document_id: str, chunk_id: str) -> Chunk | None: ...

    def count(self, document_id: str) -> int: ...


class PdfParser(Protocol):
    """Runs pdfium in its own process. Raises IngestionError or PageBatchFailed."""

    async def count_pages(self, path: Path) -> int: ...

    async def parse_pages(self, path: Path, first: int, count: int) -> PageBatch: ...

    async def close(self) -> None: ...


class TextParser(Protocol):
    def parse(self, path: Path, kind: DocumentKind, max_chars: int) -> TextContent: ...


class PageOcr(Protocol):
    """Text for pages without a text layer. Seam for OCR (phase 5b)."""

    async def recognize(self, path: Path, pages: Sequence[int]) -> list[TextSection]: ...


class MalwareScanner(Protocol):
    """Checks a file in the quarantine. Raises ScannerUnavailable (try later) or ScanFailed."""

    async def scan(self, path: Path) -> ScanVerdict: ...


class ActiveContentDetector(Protocol):
    """Names of active PDF content (JavaScript, launch actions, ...) found in a file."""

    def find(self, path: Path) -> frozenset[str]: ...
