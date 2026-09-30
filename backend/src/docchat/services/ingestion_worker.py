"""One background consumer: queued -> parsing -> embedding -> ready | failed.

Every status change is a compare-and-set. If a delete moved the row to `deleting` (or removed
it), the next progress update or transition fails, the worker drops the document and removes
what it wrote. Deleting never waits for the worker and always wins.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from docchat.domain.enums import DocumentStatus
from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.models import Document
from docchat.domain.ports import ChunkSpool, Clock, DocumentRepository, FileStorage, VectorStore
from docchat.services.document_purge import DocumentPurge
from docchat.services.embed_stage import EmbedStage
from docchat.services.ingestion_progress import DocumentGone, ProgressReporter
from docchat.services.ingestion_queue import IngestionQueue
from docchat.services.parse_stage import ParseStage

log = logging.getLogger("docchat.ingestion")


class IngestionWorker:
    def __init__(
        self,
        repository: DocumentRepository,
        storage: FileStorage,
        spool: ChunkSpool,
        vectors: VectorStore,
        parse_stage: ParseStage,
        embed_stage: EmbedStage,
        purge: DocumentPurge,
        clock: Clock,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._spool = spool
        self._vectors = vectors
        self._parse = parse_stage
        self._embed = embed_stage
        self._purge = purge
        self._clock = clock
        self._queue = IngestionQueue()
        self._task: asyncio.Task[None] | None = None
        self.current_id: str | None = None

    # Scheduling -------------------------------------------------------------------------

    def enqueue(self, document: Document) -> None:
        self._queue.put(document)

    def forget(self, document_id: str) -> None:
        self._queue.discard(document_id)

    def queue_positions(self) -> dict[str, int]:
        return self._queue.positions()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._consume(), name="ingestion-worker")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _consume(self) -> None:
        while True:
            document_id = await self._queue.get()
            # Set before the first await, so the worker never looks idle while it holds a document.
            self.current_id = document_id
            try:
                await self.process(document_id)
            finally:
                self.current_id = None

    @property
    def idle(self) -> bool:
        return not self._queue and self.current_id is None

    # Recovery ---------------------------------------------------------------------------

    async def recover(self) -> None:
        """Startup: finish deletes, requeue interrupted work, sweep orphans, queue the rest.

        A failing step is logged and skipped: recovery must never keep the app from starting.
        """
        await self._step("finish_deletes", self._finish_deletes)
        await self._step("requeue_interrupted", self._requeue_interrupted)
        await self._step("sweep_orphans", self._sweep_orphans)
        queued = await asyncio.to_thread(self._repository.list_by_status, DocumentStatus.QUEUED)
        for document in queued:
            self.enqueue(document)
        log.info("ingestion_recovered", extra={"queued": len(queued)})

    async def _step(self, name: str, step: Callable[[], Awaitable[None]]) -> None:
        try:
            await step()
        except Exception:
            log.exception("recovery_step_failed", extra={"step": name})

    async def _finish_deletes(self) -> None:
        deleting = await asyncio.to_thread(self._repository.list_by_status, DocumentStatus.DELETING)
        for document in deleting:
            await self._purge.purge(document)

    async def _requeue_interrupted(self) -> None:
        interrupted = await asyncio.to_thread(
            self._repository.list_by_status, DocumentStatus.PARSING, DocumentStatus.EMBEDDING
        )
        for document in interrupted:
            await asyncio.to_thread(self._repository.requeue, document.id, self._clock.now())

    async def _sweep_orphans(self) -> None:
        known = await asyncio.to_thread(self._repository.all_ids)
        orphans = await asyncio.to_thread(self._storage.delete_except, known)
        await asyncio.to_thread(self._storage.clear_temp)
        await asyncio.to_thread(self._spool.clear)
        await asyncio.to_thread(self._vectors.delete_documents_except, known)
        await asyncio.to_thread(self._vectors.optimize)
        log.info("orphans_swept", extra={"files": orphans})

    # Processing -------------------------------------------------------------------------

    async def process(self, document_id: str) -> None:
        document = await asyncio.to_thread(self._repository.get, document_id)
        if document is None or document.status is not DocumentStatus.QUEUED:
            return
        if not await asyncio.to_thread(
            self._repository.start_parsing, document_id, self._clock.now()
        ):
            return
        started = time.perf_counter()
        try:
            await self._ingest(document)
        except DocumentGone:
            await self._drop(document_id)
        except IngestionError as failure:
            await self._fail(document_id, failure.code)
        except Exception:
            # A parser that loses its file because the document was deleted is no crash.
            if await self._was_deleted(document_id):
                await self._drop(document_id)
            else:
                log.exception("ingestion_crashed", extra={"document_id": document_id})
                await self._fail(document_id, ErrorCode.PROCESSING_FAILED)
        else:
            log.info(
                "ingestion_ready",
                extra={
                    "document_id": document_id,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
        finally:
            await asyncio.to_thread(self._spool.discard, document_id)

    async def _ingest(self, document: Document) -> None:
        doc_id = document.id
        await asyncio.to_thread(self._vectors.delete_document, doc_id)  # idempotent restart
        path = self._storage.path_for(doc_id, document.kind)
        if not await asyncio.to_thread(self._storage.exists, doc_id, document.kind):
            raise IngestionError(ErrorCode.PROCESSING_FAILED)
        parsing = ProgressReporter(self._repository, self._clock, doc_id, DocumentStatus.PARSING)
        outcome = await self._parse.run(document, path, parsing)
        if not await asyncio.to_thread(
            self._repository.start_embedding,
            doc_id,
            self._clock.now(),
            page_count=outcome.page_count,
            chunk_count=outcome.chunk_count,
            char_count=outcome.char_count,
            notices=outcome.notices,
        ):
            raise DocumentGone
        embedding = ProgressReporter(
            self._repository, self._clock, doc_id, DocumentStatus.EMBEDDING
        )
        await self._embed.run(document, outcome.chunk_count, embedding)
        await asyncio.to_thread(self._vectors.optimize)
        if not await asyncio.to_thread(self._repository.mark_ready, doc_id, self._clock.now()):
            raise DocumentGone

    async def _was_deleted(self, document_id: str) -> bool:
        current = await asyncio.to_thread(self._repository.get, document_id)
        return current is None or current.status is DocumentStatus.DELETING

    async def _drop(self, document_id: str) -> None:
        log.info("ingestion_cancelled", extra={"document_id": document_id})
        await self._discard_index(document_id)

    async def _fail(self, document_id: str, code: ErrorCode) -> None:
        log.info("ingestion_failed", extra={"document_id": document_id, "code": code.value})
        await self._discard_index(document_id)
        await asyncio.to_thread(self._repository.mark_failed, document_id, code, self._clock.now())

    async def _discard_index(self, document_id: str) -> None:
        try:
            await asyncio.to_thread(self._vectors.delete_document, document_id)
        except Exception:
            # The startup sweep removes chunks of unknown documents; retrieval only trusts
            # documents that SQLite lists as ready.
            log.exception("ingestion_cleanup_failed", extra={"document_id": document_id})
