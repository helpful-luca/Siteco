"""Library use cases: list, show, delete, original file and single chunks."""

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode, IngestionError
from docchat.domain.models import Chunk, Document
from docchat.domain.ports import (
    Clock,
    DocumentRepository,
    FileStorage,
    IngestionScheduler,
    TextParser,
    VectorStore,
)
from docchat.services.disk_erasure import DiskErasure
from docchat.services.document_purge import DocumentPurge

log = logging.getLogger("docchat.documents")


@dataclass(frozen=True)
class DocumentView:
    document: Document
    queue_position: int | None  # 1-based place in the ingestion queue while `queued`


@dataclass(frozen=True)
class StoredFile:
    path: Path
    kind: DocumentKind
    filename: str


class DocumentService:
    def __init__(
        self,
        repository: DocumentRepository,
        storage: FileStorage,
        vectors: VectorStore,
        worker: IngestionScheduler,
        purge: DocumentPurge,
        clock: Clock,
        text_parser: TextParser,
        erasure: DiskErasure,
        max_text_chars: int,
    ) -> None:
        self._erasure = erasure
        self._text_parser = text_parser
        self._max_text_chars = max_text_chars
        self._repository = repository
        self._storage = storage
        self._vectors = vectors
        self._worker = worker
        self._purge = purge
        self._clock = clock

    def _view(self, document: Document, positions: dict[str, int]) -> DocumentView:
        return DocumentView(document, positions.get(document.id))

    def view(self, document: Document) -> DocumentView:
        return self._view(document, self._worker.queue_positions())

    def attachments(self, chat_id: str) -> list[DocumentView]:
        """Documents uploaded into the chat, newest first; the caller checks the chat exists."""
        positions = self._worker.queue_positions()
        return [self._view(d, positions) for d in self._repository.list_attachments(chat_id)]

    def add_to_library(self, document_id: str) -> DocumentView:
        """An attachment becomes a library document: listed there, searched in every chat
        whose scope includes it. Idempotent."""
        if not self._repository.add_to_library(document_id, self._clock.now()):
            raise AppError(ErrorCode.NOT_FOUND)
        log.info("document_added_to_library", extra={"document_id": document_id})
        return self.get(document_id)

    def list(self) -> list[DocumentView]:
        """The library: documents uploaded into a chat only are listed with that chat."""
        positions = self._worker.queue_positions()
        return [self._view(d, positions) for d in self._repository.list_library()]

    def _require(self, document_id: str) -> Document:
        document = self._repository.get(document_id)
        if document is None:
            raise AppError(ErrorCode.NOT_FOUND)
        return document

    def get(self, document_id: str) -> DocumentView:
        return self._view(self._require(document_id), self._worker.queue_positions())

    async def delete(self, document_id: str, *, erase: bool = True) -> None:
        """Allowed in every status. The worker notices at its next step and stops. `erase`
        makes it final on disk at once; bulk deletions pass False and erase once at the end."""
        document = await asyncio.to_thread(
            self._repository.mark_deleting, document_id, self._clock.now()
        )
        if document is None:
            raise AppError(ErrorCode.NOT_FOUND)
        self._worker.forget(document_id)
        try:
            await self._purge.purge(document)
        except Exception as exc:
            log.exception("delete_failed", extra={"document_id": document_id})
            raise AppError(ErrorCode.DELETE_FAILED) from exc
        if erase:
            await self._erasure.after_documents()
        log.info("document_deleted", extra={"document_id": document_id})

    def file(self, document_id: str) -> StoredFile:
        document = self._require(document_id)
        if document.status in (DocumentStatus.SCANNING, DocumentStatus.DELETING):
            raise AppError(ErrorCode.DOCUMENT_NOT_READY)  # not in the library (yet or anymore)
        if not self._storage.exists(document.id, document.kind):
            raise AppError(ErrorCode.DOCUMENT_FILE_MISSING)
        return StoredFile(
            self._storage.path_for(document.id, document.kind), document.kind, document.filename
        )

    def text(self, document_id: str) -> str:
        """The decoded, normalized text of a TXT/MD document: what `char_start` and `char_end`
        of its sentences count in (the raw file may be cp1252, have CRLF or a BOM)."""
        stored = self.file(document_id)
        if stored.kind is DocumentKind.PDF:
            raise AppError(ErrorCode.NOT_FOUND)
        try:
            return self._text_parser.parse(stored.path, stored.kind, self._max_text_chars).text
        except FileNotFoundError as exc:  # deleted between the lookup and now
            raise AppError(ErrorCode.DOCUMENT_FILE_MISSING) from exc
        except IngestionError as exc:
            raise AppError(exc.code) from exc

    def chunk(self, document_id: str, chunk_id: str) -> Chunk:
        document = self._require(document_id)
        if document.status is DocumentStatus.DELETING:
            raise AppError(ErrorCode.NOT_FOUND)
        chunk = self._vectors.get_chunk(document_id, chunk_id)
        if chunk is None:
            raise AppError(ErrorCode.NOT_FOUND)
        return chunk
