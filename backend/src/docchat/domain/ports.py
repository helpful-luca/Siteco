"""Capabilities the services depend on. Adapters implement them.

Blocking ports are plain methods; services call them via asyncio.to_thread. Ports that manage
their own worker process are async.
"""

from collections.abc import AsyncIterator, Collection, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Protocol

from docchat.domain.chat_models import Chat, ChatSummary, Message
from docchat.domain.enums import DocumentKind, DocumentStatus, Lane, SearchMode
from docchat.domain.errors import ErrorCode
from docchat.domain.llm import LLMEvent, LLMRequest
from docchat.domain.malware import ScanVerdict
from docchat.domain.models import Chunk, Document, Notice
from docchat.domain.parsing import PageBatch, TextContent, TextSection
from docchat.domain.preferences import Preferences
from docchat.domain.usage import UsageDay


class Clock(Protocol):
    def now(self) -> datetime: ...


class MonotonicClock(Protocol):
    """Seconds that never jump with the wall clock, for time windows."""

    def monotonic(self) -> float: ...


class Embedder(Protocol):
    dim: int

    def load(self) -> None: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class DocumentRepository(Protocol):
    """Every status change is a compare-and-set: it returns False if the row moved on (deleted)."""

    def insert(self, document: Document, *, attach_to: str | None = None) -> None: ...

    def get(self, document_id: str) -> Document | None: ...

    def list_visible(self) -> list[Document]:
        """Every document but those being deleted: library and chat attachments."""
        ...

    def list_library(self) -> list[Document]:
        """Only library documents: what the Library page, `all` scopes and MCP see."""
        ...

    def list_attachments(self, chat_id: str) -> list[Document]: ...

    def attach(self, chat_id: str, document_id: str, now: datetime) -> bool: ...

    def add_to_library(self, document_id: str, now: datetime) -> bool: ...

    def unreferenced(self, document_ids: Collection[str]) -> list[str]:
        """Of these ids, documents outside the library that no chat holds any more."""
        ...

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

    def purge_deleted(self) -> None:
        """Removes deleted rows and old versions from disk now, not after a grace period."""
        ...

    def get_chunk(self, document_id: str, chunk_id: str) -> Chunk | None: ...

    def count(self, document_id: str) -> int: ...

    def search(
        self,
        text: str,
        vector: Sequence[float],
        document_ids: Collection[str],
        limit: int,
        *,
        mode: SearchMode = SearchMode.HYBRID,
    ) -> list[Chunk]:
        """Hybrid search (vector plus full text, fused by rank) within the given documents,
        best first. The filter is applied before ranking, so `limit` results come back
        whenever the documents have that many chunks (BM25 only returns text matches)."""
        ...

    def chunks_of(self, document_ids: Collection[str]) -> list[Chunk]:
        """All chunks of the given documents, in document order (for the full-context mode)."""
        ...


class PdfParser(Protocol):
    """Runs pdfium in its own process. Raises IngestionError or PageBatchFailed."""

    async def count_pages(self, path: Path) -> int: ...

    async def parse_pages(self, path: Path, first: int, count: int) -> PageBatch: ...

    async def close(self) -> None: ...


class TextParser(Protocol):
    def parse(self, path: Path, kind: DocumentKind, max_chars: int) -> TextContent: ...


class PageOcr(Protocol):
    """Text for a page without a text layer (1-based `page`), with sentence rectangles.

    Page by page, so the parse stage can report progress: OCR takes seconds per page."""

    @property
    def available(self) -> bool:
        """False when OCR is switched off or Tesseract is missing."""
        ...

    async def recognize(self, path: Path, page: int) -> TextSection | None: ...


class MalwareScanner(Protocol):
    """Checks a file in the quarantine. Raises ScannerUnavailable (try later) or ScanFailed."""

    async def scan(self, path: Path) -> ScanVerdict: ...


class ActiveContentDetector(Protocol):
    """Names of active PDF content (JavaScript, launch actions, ...) found in a file."""

    def find(self, path: Path) -> frozenset[str]: ...


class DuplicateMessage(Exception):
    """A user message with this `client_message_id` already exists in the chat."""


class ChatRepository(Protocol):
    def insert_chat(self, chat: Chat) -> None: ...

    def get_chat(self, chat_id: str) -> Chat | None: ...

    def list_chats(self) -> list[ChatSummary]: ...

    def count_chats(self) -> int: ...

    def update_chat(self, chat: Chat) -> bool:
        """Replaces title, scope, selection and `updated_at`. False if the chat is gone."""
        ...

    def touch_chat(self, chat_id: str, now: datetime, *, auto_title: str | None) -> None:
        """Sets `updated_at`, and the title only while the chat has none and is not renamed."""
        ...

    def delete_chat(self, chat_id: str) -> bool: ...

    def delete_all_chats(self) -> int:
        """Every chat with its messages. Returns how many chats were deleted."""
        ...

    def chats_idle_since(self, cutoff: datetime) -> list[str]:
        """Ids of chats last changed before `cutoff` (retention)."""
        ...

    def redact_document(self, document_id: str) -> int:
        """Blanks the cited text of this document in every answer. Returns the changed count."""
        ...

    def redact_missing(self, existing_document_ids: Collection[str]) -> int:
        """Like redact_document for every document not in the given set."""
        ...

    def insert_message(self, message: Message) -> None:
        """Raises DuplicateMessage if the chat already has this `client_message_id`."""
        ...

    def insert_messages(self, messages: Sequence[Message]) -> None:
        """Like insert_message, for several messages in one transaction: all or nothing."""
        ...

    def get_message(self, message_id: str) -> Message | None: ...

    def find_user_message(self, chat_id: str, client_message_id: str) -> Message | None: ...

    def list_messages(self, chat_id: str) -> list[Message]:
        """Chronological."""
        ...

    def count_messages(self, chat_id: str) -> int: ...

    def answer_in_lane(self, parent_id: str, lane: Lane) -> Message | None: ...

    def save_message(self, message: Message) -> bool:
        """Overwrites every mutable column of an existing message (not `is_preferred`, see
        set_preferred). False if it is gone."""
        ...

    def set_preferred(self, comparison_id: str, message_id: str) -> bool:
        """Keeps `message_id` and unmarks the other answer of the comparison. False if none
        matched."""
        ...

    def interrupt_streaming(self) -> int:
        """Startup: answers left `streaming` by a crash become `interrupted`."""
        ...


class UsageLedger(Protocol):
    """Cost and tokens per UTC day. Survives chat deletion on purpose."""

    def record(self, day: str, cost_usd: float, input_tokens: int, output_tokens: int) -> None: ...

    def cost_on(self, day: str) -> float: ...

    def usage_on(self, day: str) -> UsageDay: ...


class SnapshotRedactor(Protocol):
    """Removes a deleted document's text from the answers that cited it."""

    def redact_document(self, document_id: str) -> int: ...


class PreferencesStore(Protocol):
    def load(self) -> Preferences | None:
        """None: nothing stored yet (or unreadable), the defaults apply."""
        ...

    def save(self, preferences: Preferences, now: datetime) -> None: ...

    def clear(self) -> None: ...


class StorageMeter(Protocol):
    def used_bytes(self) -> int:
        """Bytes the app keeps on disk: database, search index and files."""
        ...


class DatabaseMaintenance(Protocol):
    def vacuum(self) -> None: ...

    def checkpoint(self) -> bool:
        """Moves the write-ahead log into the database file and empties it. False while a
        reader still holds old pages; then the log may still contain deleted content."""
        ...


class LLMClient(Protocol):
    """Streams one answer, starting with `RequestStarted` once the request is sent.
    Raises LLMError; thinking blocks never leave the adapter."""

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMEvent]: ...


class AnswerJudge(Protocol):
    """Grades one answer for the generation eval (an LLM judge; never used by the app)."""

    def judge(self, question: str, answer: str, evidence: str, *, answerable: bool) -> bool:
        """Answerable: is the answer correct and supported by the evidence? Unanswerable: does
        it say honestly that the documents do not contain it?"""
        ...
