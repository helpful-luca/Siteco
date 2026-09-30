"""Library use cases: list, show, delete, original file and single chunks."""

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.models import Chunk, Document
from docchat.domain.ports import Clock, DocumentRepository, FileStorage, VectorStore
from docchat.services.document_purge import DocumentPurge
from docchat.services.ingestion_worker import IngestionWorker

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
        worker: IngestionWorker,
        purge: DocumentPurge,
        clock: Clock,
    ) -> None:
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

    def list(self) -> list[DocumentView]:
        positions = self._worker.queue_positions()
        return [self._view(d, positions) for d in self._repository.list_visible()]

    def _require(self, document_id: str) -> Document:
        document = self._repository.get(document_id)
        if document is None:
            raise AppError(ErrorCode.NOT_FOUND)
        return document

    def get(self, document_id: str) -> DocumentView:
        return self._view(self._require(document_id), self._worker.queue_positions())

    async def delete(self, document_id: str) -> None:
        """Allowed in every status. The worker notices at its next step and stops."""
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
        log.info("document_deleted", extra={"document_id": document_id})

    def file(self, document_id: str) -> StoredFile:
        document = self._require(document_id)
        if document.status is DocumentStatus.DELETING:
            raise AppError(ErrorCode.DOCUMENT_NOT_READY)
        if not self._storage.exists(document.id, document.kind):
            raise AppError(ErrorCode.DOCUMENT_FILE_MISSING)
        return StoredFile(
            self._storage.path_for(document.id, document.kind), document.kind, document.filename
        )

    def chunk(self, document_id: str, chunk_id: str) -> Chunk:
        document = self._require(document_id)
        if document.status is DocumentStatus.DELETING:
            raise AppError(ErrorCode.NOT_FOUND)
        chunk = self._vectors.get_chunk(document_id, chunk_id)
        if chunk is None:
            raise AppError(ErrorCode.NOT_FOUND)
        return chunk
