"""Removes everything a document left behind: index entries, files, the row."""

import asyncio

from docchat.domain.models import Document
from docchat.domain.ports import DocumentRepository, FileStorage, VectorStore


class DocumentPurge:
    def __init__(
        self, repository: DocumentRepository, storage: FileStorage, vectors: VectorStore
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._vectors = vectors

    async def purge(self, document: Document) -> None:
        """Order matters: the row goes last, so a failure leaves a `deleting` row that the next
        startup finishes. Every step is idempotent."""
        await asyncio.to_thread(self._vectors.delete_document, document.id)
        await asyncio.to_thread(self._storage.delete, document.id, document.kind)
        await asyncio.to_thread(self._storage.discard_quarantined, document.id, document.kind)
        await asyncio.to_thread(self._repository.delete, document.id)
