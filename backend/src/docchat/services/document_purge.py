"""Removes everything a document left behind: index entries, files, cited text, the row."""

import asyncio

from docchat.domain.models import Document
from docchat.domain.ports import DocumentRepository, FileStorage, SnapshotRedactor, VectorStore


class DocumentPurge:
    def __init__(
        self,
        repository: DocumentRepository,
        storage: FileStorage,
        vectors: VectorStore,
        snapshots: SnapshotRedactor,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._vectors = vectors
        self._snapshots = snapshots

    async def purge(self, document: Document) -> None:
        """Order matters: the row goes last, so a failure leaves a `deleting` row that the next
        startup finishes. Every step is idempotent."""
        await asyncio.to_thread(self._vectors.delete_document, document.id)
        await asyncio.to_thread(self._storage.delete, document.id, document.kind)
        await asyncio.to_thread(self._storage.discard_quarantined, document.id, document.kind)
        # Answers that cited the document keep file name and page, not its text (10b, 4).
        await asyncio.to_thread(self._snapshots.redact_document, document.id)
        await asyncio.to_thread(self._repository.delete, document.id)
