"""Makes deletions final on disk (master spec 10b, 4).

Deleting rows is not enough: the search index keeps old versions for a while, and SQLite's
write-ahead log still holds the pages from before. After a deletion the index is purged at
once and the log is moved into the database file and emptied. A reader that holds old pages
can block the log for a moment; then it is tried again in the background."""

import asyncio
import logging

from docchat.domain.ports import DatabaseMaintenance, VectorStore

log = logging.getLogger("docchat.erasure")


class DiskErasure:
    def __init__(
        self,
        vectors: VectorStore,
        database: DatabaseMaintenance,
        *,
        retry_every_s: float = 2.0,
        retry_for_s: float = 300.0,
    ) -> None:
        self._vectors = vectors
        self._database = database
        self._retry_every_s = retry_every_s
        self._retry_for_s = retry_for_s
        self._retry: asyncio.Task[None] | None = None
        self.log_pending = False

    async def after_rows(self) -> None:
        """Rows were deleted or overwritten in SQLite (secure_delete zeroes the pages)."""
        if await asyncio.to_thread(self._database.checkpoint):
            self.log_pending = False
            return
        self.log_pending = True
        log.warning("wal_checkpoint_busy")
        if self._retry is None or self._retry.done():
            self._retry = asyncio.create_task(self._retry_checkpoint(), name="wal-checkpoint")

    async def after_documents(self) -> None:
        """Documents were deleted: their index rows and old index versions go now."""
        try:
            await asyncio.to_thread(self._vectors.purge_deleted)
        except Exception:
            # The index is not open (search model failed to load): nothing of it to purge now;
            # the startup sweep and the next purge remove what is left.
            log.exception("vector_purge_failed")
        await self.after_rows()

    async def after_wipe(self) -> None:
        """Everything was deleted: rewrite the database file, then as after documents."""
        await asyncio.to_thread(self._database.vacuum)
        await self.after_documents()

    async def _retry_checkpoint(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._retry_for_s
        while loop.time() < deadline:
            await asyncio.sleep(self._retry_every_s)
            if await asyncio.to_thread(self._database.checkpoint):
                self.log_pending = False
                log.info("wal_checkpoint_done")
                return
        log.error("wal_checkpoint_gave_up")

    async def stop(self) -> None:
        task, self._retry = self._retry, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
