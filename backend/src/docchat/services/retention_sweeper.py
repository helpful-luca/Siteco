"""Automatic deletion (master spec 10b, 6), chosen in Settings > Data; RETENTION_DAYS is only
the default until then. Off by default. The setting is read at every sweep.

Chats count from their last change, documents from their upload. A chat with a running
answer waits for the next sweep."""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from docchat.domain.enums import DocumentStatus
from docchat.domain.errors import AppError
from docchat.domain.ports import ChatRepository, Clock, DocumentRepository
from docchat.services.chat_service import ChatService
from docchat.services.disk_erasure import DiskErasure
from docchat.services.document_service import DocumentService

log = logging.getLogger("docchat.retention")


@dataclass(frozen=True)
class SweepResult:
    chats: int
    documents: int


class RetentionSweeper:
    def __init__(
        self,
        chat_service: ChatService,
        chats: ChatRepository,
        documents: DocumentRepository,
        library: DocumentService,
        erasure: DiskErasure,
        clock: Clock,
        *,
        days: Callable[[], int | None],
        interval_s: float = 3600,
    ) -> None:
        self._chat_service = chat_service
        self._chats = chats
        self._documents = documents
        self._library = library
        self._erasure = erasure
        self._clock = clock
        self._days = days
        self._interval_s = interval_s
        self._task: asyncio.Task[None] | None = None

    async def sweep_once(self) -> SweepResult:
        days = await asyncio.to_thread(self._days)
        if not days:
            return SweepResult(0, 0)
        cutoff = self._clock.now() - timedelta(days=days)
        chats = 0
        for chat_id in await asyncio.to_thread(self._chats.chats_idle_since, cutoff):
            # A chat with a running answer waits for the next sweep.
            if await self._chat_service.delete_if_idle(chat_id):
                chats += 1
        documents = 0
        for document in await asyncio.to_thread(self._documents.list_visible):
            if document.created_at >= cutoff or document.status is DocumentStatus.DELETING:
                continue
            try:
                await self._library.delete(document.id, erase=False)
                documents += 1
            except AppError:
                continue  # deleted meanwhile, or the next sweep tries again
        if chats or documents:  # a deleted chat may have taken its attachments along
            await self._erasure.after_documents()
        if chats or documents:
            log.info("retention_swept", extra={"chats": chats, "documents": documents})
        return SweepResult(chats, documents)

    def start(self) -> None:
        if self._task is None:  # always: the setting may be switched on at any time
            self._task = asyncio.create_task(self._loop(), name="retention-sweeper")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self) -> None:
        while True:
            try:
                await self.sweep_once()
            except Exception:
                log.exception("retention_sweep_failed")
            await asyncio.sleep(self._interval_s)
