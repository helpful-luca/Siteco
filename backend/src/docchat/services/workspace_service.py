"""The workspace as a whole: what it holds, and deleting all of it.

There is exactly one workspace per installation."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC

from docchat.domain.enums import DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import (
    ChatRepository,
    Clock,
    DocumentRepository,
    FileStorage,
    StorageMeter,
    UsageLedger,
    VectorStore,
)
from docchat.domain.usage import UsageDay
from docchat.services.api_key_service import ApiKeyService
from docchat.services.disk_erasure import DiskErasure
from docchat.services.document_service import DocumentService
from docchat.services.limits import DailyBudget
from docchat.services.preferences_service import PreferencesService
from docchat.services.run_registry import RunRegistry

log = logging.getLogger("docchat.workspace")

_ALL_STATUSES = tuple(DocumentStatus)


@dataclass(frozen=True)
class WorkspaceParts:
    chats: ChatRepository
    documents: DocumentRepository
    library: DocumentService
    storage: FileStorage
    vectors: VectorStore
    runs: RunRegistry
    preferences: PreferencesService
    meter: StorageMeter
    erasure: DiskErasure
    ledger: UsageLedger
    budget: DailyBudget
    clock: Clock
    api_keys: ApiKeyService | None = None  # the Claude key from Settings


@dataclass(frozen=True)
class WorkspaceStats:
    documents: int
    chats: int
    documents_bytes: int  # the original files
    storage_bytes: int  # everything on disk: files, search index, database
    usage_today: UsageDay
    usage_month: UsageDay  # since the first of the current UTC month
    budget_usd: float | None
    retention_days: int | None  # None: automatic deletion is off


class WorkspaceService:
    def __init__(self, parts: WorkspaceParts) -> None:
        self._p = parts

    async def stats(self) -> WorkspaceStats:
        p = self._p
        documents = await asyncio.to_thread(p.documents.list_visible)
        day = p.clock.now().astimezone(UTC).date()
        today = day.isoformat()
        return WorkspaceStats(
            documents=len(documents),
            chats=await asyncio.to_thread(p.chats.count_chats),
            documents_bytes=sum(d.size_bytes for d in documents),
            storage_bytes=await asyncio.to_thread(p.meter.used_bytes),
            usage_today=await asyncio.to_thread(p.ledger.usage_on, today),
            usage_month=await asyncio.to_thread(
                p.ledger.usage_since, day.replace(day=1).isoformat()
            ),
            budget_usd=p.budget.limit_usd,
            retention_days=p.preferences.get().retention_days or None,
        )

    async def recover(self) -> None:
        """Startup: answers must not keep text of documents that are gone (a crash between
        purge steps, or an answer saved while its source was being deleted)."""
        existing = {d.id for d in await asyncio.to_thread(self._p.documents.list_visible)}
        count = await asyncio.to_thread(self._p.chats.redact_missing, existing)
        if count:
            log.info("snapshots_redacted", extra={"count": count})

    async def wipe(self, *, reset_preferences: bool) -> None:
        """Deletes every document (files, index, rows), chat and message; with
        `reset_preferences` also name and settings, including the API key from Settings.
        Running answers are stopped first. Idempotent: a failed run can simply be repeated.
        The usage ledger stays."""
        p = self._p
        await p.runs.stop_all_and_wait()
        try:
            chats = await asyncio.to_thread(p.chats.delete_all_chats)
            documents = await asyncio.to_thread(p.documents.list_by_status, *_ALL_STATUSES)
            for document in documents:
                try:
                    await p.library.delete(document.id, erase=False)
                except AppError as exc:
                    if exc.code is not ErrorCode.NOT_FOUND:  # deleted meanwhile
                        raise
            await self._sweep()
            if reset_preferences:
                await asyncio.to_thread(p.preferences.reset)
                if p.api_keys is not None:  # settings include the key entered in the app
                    await p.api_keys.delete()
            await p.erasure.after_wipe()
        except AppError:
            raise
        except Exception as exc:
            log.exception("workspace_wipe_failed")
            raise AppError(ErrorCode.DELETE_FAILED) from exc
        log.info(
            "workspace_wiped",
            extra={"chats": chats, "documents": len(documents), "reset": reset_preferences},
        )

    async def _sweep(self) -> None:
        """Whatever no row points to any more: files, quarantine and index entries. An upload
        that arrived during the wipe keeps its row and therefore its file. Spool files of a
        cancelled ingestion are removed by the worker itself."""
        p = self._p
        keep = await asyncio.to_thread(p.documents.all_ids)
        await asyncio.to_thread(p.storage.delete_except, keep)
        await asyncio.to_thread(p.storage.discard_quarantined_except, keep)
        await asyncio.to_thread(p.vectors.delete_documents_except, keep)
