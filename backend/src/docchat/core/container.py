"""Composition root: the only place that builds concrete adapters and wires them together."""

import asyncio
import logging
import os
import random
import shutil
from collections.abc import Callable
from dataclasses import dataclass

from docchat.adapters.anthropic.client import AnthropicLLMClient
from docchat.adapters.anthropic.key_validator import AnthropicKeyValidator
from docchat.adapters.clamd_scanner import ClamdScanner
from docchat.adapters.directory_size_meter import DirectorySizeMeter
from docchat.adapters.dns_resolver import SystemHostResolver
from docchat.adapters.fake_llm import FakeLLMClient
from docchat.adapters.fastembed_embedder import FastEmbedEmbedder
from docchat.adapters.file_secret_store import FileSecretStore
from docchat.adapters.http_url_fetcher import HttpUrlFetcher
from docchat.adapters.jsonl_chunk_spool import JsonlChunkSpool
from docchat.adapters.lancedb_vector_store import LanceVectorStore
from docchat.adapters.local_file_storage import LocalFileStorage
from docchat.adapters.no_page_ocr import NoPageOcr
from docchat.adapters.pdf_active_content_detector import PdfActiveContentDetector
from docchat.adapters.pdfium_ocr_page import OcrOptions
from docchat.adapters.pdfium_parser import TASKS_PER_PROCESS, PdfiumParser
from docchat.adapters.process_runner import IsolatedProcess
from docchat.adapters.sqlite.chat_repository import SqliteChatRepository
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.sqlite.preferences_store import SqlitePreferencesStore
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.adapters.system_clock import SystemClock
from docchat.adapters.tesseract_ocr import TesseractPageOcr
from docchat.adapters.text_parser import TextFileParser
from docchat.core.config import Settings
from docchat.domain.enums import ComponentStatus, LlmStatus
from docchat.domain.ports import (
    Embedder,
    HostResolver,
    KeyValidator,
    LLMClient,
    MalwareScanner,
    PageOcr,
    PdfParser,
    VectorStore,
)
from docchat.domain.url_import import address_is_public
from docchat.services.answer_run import RunDeps, RunTimings
from docchat.services.answer_service import AnswerLimits, AnswerService
from docchat.services.api_key_service import ApiKeyService
from docchat.services.chat_service import ChatService
from docchat.services.disk_erasure import DiskErasure
from docchat.services.document_purge import DocumentPurge
from docchat.services.document_service import DocumentService
from docchat.services.embed_stage import EmbedBatching, EmbedStage
from docchat.services.ingestion_worker import IngestionWorker
from docchat.services.library_search import LibrarySearch
from docchat.services.limits import DailyBudget, LimitScope, RateLimit
from docchat.services.llm_health import LlmHealth
from docchat.services.malware_scan_worker import MalwareScanWorker, ScanRetry
from docchat.services.model_availability import ModelAvailability
from docchat.services.parse_stage import ParseLimits, ParseStage
from docchat.services.preferences_service import PreferencesService
from docchat.services.retention_sweeper import RetentionSweeper
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from docchat.services.run_registry import RunRegistry
from docchat.services.swappable_llm import SwappableLLM
from docchat.services.upload_service import UploadLimits, UploadService
from docchat.services.url_import_service import UrlImportService
from docchat.services.workspace_export import WorkspaceExport
from docchat.services.workspace_service import WorkspaceParts, WorkspaceService

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
    url_imports: UrlImportService
    chats: ChatService
    answers: AnswerService
    llm_health: LlmHealth
    api_keys: ApiKeyService
    models: ModelAvailability
    budget: DailyBudget
    preferences: PreferencesService
    workspace: WorkspaceService
    export: WorkspaceExport
    retention: RetentionSweeper
    erasure: DiskErasure
    library: LibrarySearch
    embedder_status: ComponentStatus = ComponentStatus.LOADING
    vector_store_status: ComponentStatus = ComponentStatus.LOADING

    @property
    def llm_status(self) -> LlmStatus:
        return self.llm_health.status

    async def start(self) -> None:
        self.database.migrate()
        await asyncio.to_thread(self.chats.recover)
        await self.workspace.recover()
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
            # Deletions finished during recovery (or cut off by a crash) become final on disk.
            await self.erasure.after_documents()
            self.worker.start()
        self.retention.start()

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
        await self.retention.stop()
        await self.url_imports.stop()
        await self.erasure.stop()
        await self.scans.stop()
        await self.worker.stop()
        await self.pdf_parser.close()
        await self.parser_process.close()  # shared with OCR; closing twice is harmless


def _default_threads() -> int:
    return max(1, (os.cpu_count() or 2) // 2)


def _scanner(settings: Settings) -> MalwareScanner:
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
        return NoPageOcr(engine_missing=True)
    options = OcrOptions(languages=settings.ocr_languages, timeout_s=settings.ocr_page_timeout_s)
    return TesseractPageOcr(process, options)


def _api_keys(
    settings: Settings,
    llm: LLMClient | None,
    validator: KeyValidator | None,
) -> tuple[ApiKeyService, LlmHealth, SwappableLLM]:
    """Fake for E2E and demos (or a test's client): fixed. Otherwise Claude with the key from
    Settings or ANTHROPIC_API_KEY, swapped when the key changes; without a key none
    (retrieval-only)."""
    fixed = llm or (FakeLLMClient() if settings.llm_provider == "fake" else None)
    health = LlmHealth(LlmStatus.OK if fixed is not None else LlmStatus.MISSING_KEY)
    handle = SwappableLLM(fixed)

    def build(key: str) -> LLMClient:
        return AnthropicLLMClient(
            key, sonnet_thinking=settings.sonnet_thinking, concurrency=settings.llm_concurrency
        )

    env_key = settings.anthropic_api_key
    keys = ApiKeyService(
        FileSecretStore(settings.secrets_dir / "anthropic_api_key"),
        validator or AnthropicKeyValidator(),
        health,
        handle,
        build,
        env_key=env_key.get_secret_value() if env_key is not None else None,
        swaps_client=fixed is None,
    )
    keys.load()
    return keys, health, handle


def build_container(
    settings: Settings,
    *,
    embedder: Embedder | None = None,
    pdf_parser: PdfParser | None = None,
    scanner: MalwareScanner | None = None,
    llm: LLMClient | None = None,
    clock: SystemClock | None = None,
    key_validator: KeyValidator | None = None,
    url_resolver: HostResolver | None = None,
    url_is_public: Callable[[str], bool] | None = None,
) -> Container:
    database = Database(settings.database_path)
    repository = SqliteDocumentRepository(database)
    storage = LocalFileStorage(settings.uploads_dir, settings.quarantine_dir)
    spool = JsonlChunkSpool(settings.spool_dir)
    vectors = LanceVectorStore(settings.lancedb_dir, fts_language=settings.fts_language)
    clock = clock or SystemClock()  # tests pass one that can jump ahead
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
    chats = SqliteChatRepository(database)
    purge = DocumentPurge(repository, storage, vectors, chats)
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
    runs = RunRegistry(settings.max_concurrent_streams)
    api_keys, llm_health, llm_handle = _api_keys(settings, llm, key_validator)
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
        llm=llm_handle,
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
    erasure = DiskErasure(vectors, database)
    documents = DocumentService(
        repository,
        storage,
        vectors,
        worker,
        purge,
        clock,
        text_parser,
        erasure,
        max_text_chars=settings.max_chars_per_doc,
    )
    chat_service = ChatService(
        chats, repository, runs, clock, erasure, documents, max_chats=settings.max_chats
    )
    upload_rate = RateLimit(LimitScope.UPLOAD, settings.rate_upload_per_min, clock)
    uploads = UploadService(
        repository,
        storage,
        scans,
        clock,
        UploadLimits(
            max_bytes=settings.max_upload_mb * _MB,
            max_storage_bytes=settings.max_storage_mb * _MB,
            min_free_bytes=settings.min_free_disk_mb * _MB,
        ),
        upload_rate,
    )
    preferences = PreferencesService(
        SqlitePreferencesStore(database),
        clock,
        settings.enabled_models,
        settings.default_model,
        retention_days=settings.retention_days,
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
        documents=documents,
        uploads=uploads,
        url_imports=UrlImportService(
            uploads,
            chats,
            url_resolver or SystemHostResolver(),
            HttpUrlFetcher(
                connect_timeout_s=settings.url_connect_timeout_s,
                read_timeout_s=settings.url_read_timeout_s,
            ),
            max_bytes=settings.max_upload_mb * _MB,
            total_timeout_s=settings.url_import_timeout_s,
            rate=upload_rate,  # an import counts as an upload
            is_public=url_is_public or address_is_public,
        ),
        chats=chat_service,
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
        api_keys=api_keys,
        models=models,
        budget=budget,
        preferences=preferences,
        workspace=WorkspaceService(
            WorkspaceParts(
                chats=chats,
                documents=repository,
                library=documents,
                storage=storage,
                vectors=vectors,
                runs=runs,
                preferences=preferences,
                meter=DirectorySizeMeter(settings.data_dir),
                erasure=erasure,
                ledger=ledger,
                budget=budget,
                clock=clock,
                api_keys=api_keys,
            ),
        ),
        export=WorkspaceExport(
            chats, repository, preferences, clock, tmp_dir=settings.data_dir / "tmp"
        ),
        retention=RetentionSweeper(
            chat_service,
            chats,
            repository,
            documents,
            erasure,
            clock,
            days=lambda: preferences.get().retention_days,
            interval_s=settings.retention_sweep_interval_s,
        ),
        erasure=erasure,
        library=LibrarySearch(repository, retrieval),
    )
