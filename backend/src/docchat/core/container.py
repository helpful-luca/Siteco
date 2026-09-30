"""Composition root: the only place that builds concrete adapters and wires them together."""

import asyncio
import logging
import os
from dataclasses import dataclass

from docchat.adapters.clamd_scanner import ClamdScanner
from docchat.adapters.fastembed_embedder import FastEmbedEmbedder
from docchat.adapters.jsonl_chunk_spool import JsonlChunkSpool
from docchat.adapters.lancedb_vector_store import LanceVectorStore
from docchat.adapters.local_file_storage import LocalFileStorage
from docchat.adapters.no_page_ocr import NoPageOcr
from docchat.adapters.noop_malware_scanner import NoopMalwareScanner
from docchat.adapters.pdf_active_content_detector import PdfActiveContentDetector
from docchat.adapters.pdfium_parser import PdfiumParser
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.system_clock import SystemClock
from docchat.adapters.text_parser import TextFileParser
from docchat.core.config import Settings
from docchat.domain.enums import ComponentStatus, LlmStatus
from docchat.domain.ports import Embedder, MalwareScanner, PdfParser, VectorStore
from docchat.services.document_purge import DocumentPurge
from docchat.services.document_service import DocumentService
from docchat.services.embed_stage import EmbedBatching, EmbedStage
from docchat.services.ingestion_worker import IngestionWorker
from docchat.services.malware_scan_worker import MalwareScanWorker, ScanRetry
from docchat.services.parse_stage import ParseLimits, ParseStage
from docchat.services.upload_service import UploadLimits, UploadService

log = logging.getLogger("docchat.container")

_MB = 1024 * 1024


@dataclass
class Container:
    settings: Settings
    database: Database
    embedder: Embedder
    vectors: VectorStore
    pdf_parser: PdfParser
    worker: IngestionWorker
    scans: MalwareScanWorker
    documents: DocumentService
    uploads: UploadService
    embedder_status: ComponentStatus = ComponentStatus.LOADING
    vector_store_status: ComponentStatus = ComponentStatus.LOADING
    llm_status: LlmStatus = LlmStatus.MISSING_KEY

    async def start(self) -> None:
        self.database.migrate()
        self.llm_status = (
            LlmStatus.UNCHECKED if self.settings.llm_key_configured else LlmStatus.MISSING_KEY
        )
        await self._load_embedder()
        await self._open_vector_store()
        if self.embedder_status is ComponentStatus.OK and (
            self.vector_store_status is ComponentStatus.OK
        ):
            await self.scans.recover()
            await self.worker.recover()
            self.scans.start()
            self.worker.start()

    async def _load_embedder(self) -> None:
        try:
            await asyncio.to_thread(self.embedder.load)
        except Exception:
            log.exception("embedder_load_failed")
            self.embedder_status = ComponentStatus.FAILED
        else:
            self.embedder_status = ComponentStatus.OK

    async def _open_vector_store(self) -> None:
        if self.embedder_status is not ComponentStatus.OK:
            self.vector_store_status = ComponentStatus.FAILED
            return
        try:
            await asyncio.to_thread(self.vectors.open, self.embedder.dim)
        except Exception:
            log.exception("vector_store_open_failed")
            self.vector_store_status = ComponentStatus.FAILED
        else:
            self.vector_store_status = ComponentStatus.OK

    async def stop(self) -> None:
        """Stop background work started in start()."""
        await self.scans.stop()
        await self.worker.stop()
        await self.pdf_parser.close()


def _default_threads() -> int:
    return max(1, (os.cpu_count() or 2) // 2)


def _scanner(settings: Settings) -> MalwareScanner:
    if settings.malware_scan == "off":
        return NoopMalwareScanner()
    return ClamdScanner(
        settings.clamd_host,
        settings.clamd_port,
        scan_timeout_s=settings.clamd_scan_timeout_s,
        max_stream_bytes=settings.clamd_stream_max_mb * _MB,
    )


def build_container(
    settings: Settings,
    *,
    embedder: Embedder | None = None,
    pdf_parser: PdfParser | None = None,
    scanner: MalwareScanner | None = None,
) -> Container:
    database = Database(settings.database_path)
    repository = SqliteDocumentRepository(database)
    storage = LocalFileStorage(settings.uploads_dir, settings.quarantine_dir)
    spool = JsonlChunkSpool(settings.spool_dir)
    vectors = LanceVectorStore(settings.lancedb_dir, fts_language=settings.fts_language)
    clock = SystemClock()
    embedder = embedder or FastEmbedEmbedder(
        settings.embedding_model,
        settings.embedding_cache_dir,
        local_files_only=settings.embedding_local_only,
        threads=settings.embedding_threads or _default_threads(),
    )
    pdf_parser = pdf_parser or PdfiumParser(timeout_s=settings.parse_timeout_s)
    purge = DocumentPurge(repository, storage, vectors)
    parse_stage = ParseStage(
        spool,
        pdf_parser,
        TextFileParser(),
        NoPageOcr(),
        PdfActiveContentDetector(),
        ParseLimits(
            max_pdf_pages=settings.max_pdf_pages,
            max_chars=settings.max_chars_per_doc,
            batch_pages=settings.parse_batch_pages,
            max_failed_batches=settings.parse_max_failed_batches,
        ),
    )
    embed_stage = EmbedStage(
        spool,
        embedder,
        vectors,
        EmbedBatching(
            embed_batch_size=settings.embed_batch_size,
            write_batch_size=settings.index_write_batch,
        ),
    )
    worker = IngestionWorker(
        repository, storage, spool, vectors, parse_stage, embed_stage, purge, clock
    )
    scans = MalwareScanWorker(
        repository, storage, scanner or _scanner(settings), worker, clock, ScanRetry()
    )
    return Container(
        settings=settings,
        database=database,
        embedder=embedder,
        vectors=vectors,
        pdf_parser=pdf_parser,
        worker=worker,
        scans=scans,
        documents=DocumentService(repository, storage, vectors, worker, purge, clock),
        uploads=UploadService(
            repository,
            storage,
            scans,
            clock,
            UploadLimits(
                max_bytes=settings.max_upload_mb * _MB,
                max_storage_bytes=settings.max_storage_mb * _MB,
                min_free_bytes=settings.min_free_disk_mb * _MB,
            ),
        ),
    )
