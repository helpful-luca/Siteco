"""Composition root: the only place that builds concrete adapters and wires them together."""

import asyncio
import logging
from dataclasses import dataclass

from docchat.adapters.fastembed_embedder import FastEmbedEmbedder
from docchat.adapters.sqlite.database import Database
from docchat.core.config import Settings
from docchat.domain.enums import ComponentStatus, LlmStatus
from docchat.domain.ports import Embedder

log = logging.getLogger("docchat.container")


@dataclass
class Container:
    settings: Settings
    database: Database
    embedder: Embedder
    embedder_status: ComponentStatus = ComponentStatus.LOADING
    llm_status: LlmStatus = LlmStatus.MISSING_KEY

    async def start(self) -> None:
        self.database.migrate()
        self.llm_status = (
            LlmStatus.UNCHECKED if self.settings.llm_key_configured else LlmStatus.MISSING_KEY
        )
        await self._load_embedder()

    async def _load_embedder(self) -> None:
        try:
            await asyncio.to_thread(self.embedder.load)
        except Exception:
            log.exception("embedder_load_failed")
            self.embedder_status = ComponentStatus.FAILED
        else:
            self.embedder_status = ComponentStatus.OK

    async def stop(self) -> None:
        """Stop background work started in start()."""
        return


def build_container(settings: Settings, *, embedder: Embedder | None = None) -> Container:
    return Container(
        settings=settings,
        database=Database(settings.database_path),
        embedder=embedder
        or FastEmbedEmbedder(
            settings.embedding_model,
            settings.embedding_cache_dir,
            local_files_only=settings.embedding_local_only,
        ),
    )
