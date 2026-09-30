"""Progress reporting that doubles as the cancellation check of the worker."""

import asyncio

from docchat.domain.enums import DocumentStatus
from docchat.domain.ports import Clock, DocumentRepository


class DocumentGone(Exception):
    """The document was deleted while the worker was busy with it."""


class ProgressReporter:
    """Writes progress with a compare-and-set on the stage. If the row moved on (a delete set it
    to `deleting` or removed it), the update hits no row and the worker stops."""

    def __init__(
        self,
        repository: DocumentRepository,
        clock: Clock,
        document_id: str,
        status: DocumentStatus,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._document_id = document_id
        self._status = status

    async def __call__(self, fraction: float, *, page_count: int | None = None) -> None:
        updated = await asyncio.to_thread(
            self._repository.set_progress,
            self._document_id,
            self._status,
            fraction,
            self._clock.now(),
            page_count=page_count,
        )
        if not updated:
            raise DocumentGone
