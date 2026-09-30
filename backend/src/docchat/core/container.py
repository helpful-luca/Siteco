"""Composition root: the only place that builds concrete adapters and wires them together."""

import asyncio
import logging
import os
import random
import shutil
from dataclasses import dataclass

from docchat.adapters.anthropic.client import AnthropicLLMClient
from docchat.adapters.clamd_scanner import ClamdScanner
from docchat.adapters.fake_llm import FakeLLMClient
from docchat.adapters.fastembed_embedder import FastEmbedEmbedder
from docchat.adapters.jsonl_chunk_spool import JsonlChunkSpool
from docchat.adapters.lancedb_vector_store import LanceVectorStore
from docchat.adapters.local_file_storage import LocalFileStorage
from docchat.adapters.no_page_ocr import NoPageOcr
from docchat.adapters.noop_malware_scanner import NoopMalwareScanner
from docchat.adapters.pdf_active_content_detector import PdfActiveContentDetector
from docchat.adapters.pdfium_ocr_page import OcrOptions
from docchat.adapters.pdfium_parser import TASKS_PER_PROCESS, PdfiumParser
from docchat.adapters.process_runner import IsolatedProcess
from docchat.adapters.sqlite.chat_repository import SqliteChatRepository
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.adapters.system_clock import SystemClock
from docchat.adapters.tesseract_ocr import TesseractPageOcr
from docchat.adapters.text_parser import TextFileParser
from docchat.core.config import Settings
from docchat.domain.enums import ComponentStatus, LlmStatus
from docchat.domain.ports import (
    Embedder,
    LLMClient,
    MalwareScanner,
    PageOcr,
    PdfParser,
    VectorStore,
)
from docchat.services.answer_run import RunDeps, RunTimings
from docchat.services.answer_service import AnswerLimits, AnswerService
from docchat.services.chat_service import ChatService
from docchat.services.document_purge import DocumentPurge
from docchat.services.document_service import DocumentService
from docchat.services.embed_stage import EmbedBatching, EmbedStage
from docchat.services.ingestion_worker import IngestionWorker
from docchat.services.limits import DailyBudget, LimitScope, RateLimit
from docchat.services.llm_health import LlmHealth
from docchat.services.malware_scan_worker import MalwareScanWorker, ScanRetry
from docchat.services.model_availability import ModelAvailability
from docchat.services.parse_stage import ParseLimits, ParseStage
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from docchat.services.run_registry import RunRegistry
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
    parser_process: IsolatedProcess
    worker: IngestionWorker
    scans: MalwareScanWorker
    documents: DocumentService
    uploads: UploadService
    chats: ChatService
    answers: AnswerService
    llm_health: LlmHealth
    models: ModelAvailability
    budget: DailyBudget
    embedder_status: ComponentStatus = ComponentStatus.LOADING
    vector_store_status: ComponentStatus = ComponentStatus.LOADING

    @property
    def llm_status(self) -> LlmStatus:
        return self.llm_health.status

    async def start(self) -> None:
        self.database.migrate()
        await asyncio.to_thread(self.chats.recover)
        # The malware scan needs neither the model nor the index: it runs from the start, so
        # uploads never wait in `scanning` because the embedder failed or is still loading.
        await self.scans.recover()
        self.scans.start()
        await self._load_embedder()
        await self._open_vector_store()
        if self.embedder_status is ComponentStatus.OK and (
            self.vector_store_status is ComponentStatus.OK
        ):
            await self.worker.recover()
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
        await self.parser_process.close()  # shared with OCR; closing twice is harmless


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


def _ocr(settings: Settings, process: IsolatedProcess) -> PageOcr:
    if settings.ocr == "off":
        return NoPageOcr()
    if shutil.which("tesseract") is None:
        # Local development without Tesseract; the Docker image always has it.
        log.warning("ocr_unavailable")
        return NoPageOcr()
    options = OcrOptions(languages=settings.ocr_languages, timeout_s=settings.ocr_page_timeout_s)
    return TesseractPageOcr(process, options)


def _llm(settings: Settings) -> tuple[LLMClient | None, LlmStatus]:
    """Fake for E2E and demos; Claude with a key; without a key none (retrieval-only)."""
    if settings.llm_provider == "fake":
        return FakeLLMClient(), LlmStatus.OK
    if settings.anthropic_api_key is None:
        return None, LlmStatus.MISSING_KEY
    client = AnthropicLLMClient(
        settings.anthropic_api_key.get_secret_value(),
        sonnet_thinking=settings.sonnet_thinking,
        concurrency=settings.llm_concurrency,
    )
    return client, LlmStatus.UNCHECKED


def build_container(
    settings: Settings,
    *,
    embedder: Embedder | None = None,
    pdf_parser: PdfParser | None = None,
    scanner: MalwareScanner | None = None,
    llm: LLMClient | None = None,
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
    # One isolated process for all pdfium work: page text and the rendering for OCR.
    parser_process = IsolatedProcess(max_tasks_per_child=TASKS_PER_PROCESS)
    pdf_parser = pdf_parser or PdfiumParser(
        timeout_s=settings.parse_timeout_s, process=parser_process
    )
    purge = DocumentPurge(repository, storage, vectors)
    text_parser = TextFileParser()
    parse_stage = ParseStage(
        spool,
        pdf_parser,
        text_parser,
        _ocr(settings, parser_process),
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
    chats = SqliteChatRepository(database)
    runs = RunRegistry(settings.max_concurrent_streams)
    llm_client, llm_status = (llm, LlmStatus.OK) if llm is not None else _llm(settings)
    llm_health = LlmHealth(llm_status)
    models = ModelAvailability(settings.enabled_models, settings.default_model, clock)
    ledger = SqliteUsageLedger(database)
    budget = DailyBudget(ledger, clock, settings.daily_budget_usd)
    retrieval = RetrievalService(
        repository,
        vectors,
        embedder,
        RetrievalSettings(
            candidates=settings.retrieval_candidates,
            top_k=settings.top_k,
            per_document_cap=settings.per_document_cap,
            full_context_max_tokens=settings.full_context_max_tokens,
        ),
    )
    run_deps = RunDeps(
        chats=chats,
        retrieval=retrieval,
        llm=llm_client,
        health=llm_health,
        ledger=ledger,
        clock=clock,
        registry=runs,
        timings=RunTimings(
            ttft_timeout_s=settings.llm_ttft_timeout_s,
            total_timeout_s=settings.llm_total_timeout_s,
            max_retries=settings.llm_max_retries,
        ),
        models=models,
        jitter=random.random,
    )
    return Container(
        settings=settings,
        database=database,
        embedder=embedder,
        vectors=vectors,
        pdf_parser=pdf_parser,
        parser_process=parser_process,
        worker=worker,
        scans=scans,
        documents=DocumentService(
            repository,
            storage,
            vectors,
            worker,
            purge,
            clock,
            text_parser,
            max_text_chars=settings.max_chars_per_doc,
        ),
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
            RateLimit(LimitScope.UPLOAD, settings.rate_upload_per_min, clock),
        ),
        chats=ChatService(chats, repository, runs, clock, max_chats=settings.max_chats),
        answers=AnswerService(
            run_deps,
            AnswerLimits(
                enabled_models=tuple(settings.enabled_models),
                max_question_chars=settings.max_question_chars,
                max_messages_per_chat=settings.max_messages_per_chat,
                max_output_tokens=settings.max_output_tokens,
                history_max_turns=settings.history_max_turns,
                history_max_tokens=settings.history_max_tokens,
            ),
            rate=RateLimit(LimitScope.CHAT, settings.rate_chat_per_min, clock),
            budget=budget,
        ),
        llm_health=llm_health,
        models=models,
        budget=budget,
    )
