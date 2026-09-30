"""Services wired with real SQLite, files and spool (cheap) and fakes for the heavy ports."""

from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest

from docchat.adapters.jsonl_chunk_spool import JsonlChunkSpool
from docchat.adapters.local_file_storage import LocalFileStorage
from docchat.adapters.no_page_ocr import NoPageOcr
from docchat.adapters.noop_malware_scanner import NoopMalwareScanner
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.text_parser import TextFileParser
from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.models import Document
from docchat.services.document_purge import DocumentPurge
from docchat.services.document_service import DocumentService
from docchat.services.embed_stage import EmbedBatching, EmbedStage
from docchat.services.ingestion_worker import IngestionWorker
from docchat.services.parse_stage import ParseLimits, ParseStage
from docchat.services.upload_service import UploadLimits, UploadService
from tests.fakes import FakeClock, FakeEmbedder, FakePdfParser, FakeVectorStore

MB = 1024 * 1024


@dataclass
class Harness:
    root: Path
    repository: SqliteDocumentRepository
    storage: LocalFileStorage
    spool: JsonlChunkSpool
    vectors: FakeVectorStore
    pdf: FakePdfParser
    embedder: FakeEmbedder
    clock: FakeClock
    worker: IngestionWorker
    documents: DocumentService
    uploads: UploadService

    def add_document(
        self,
        kind: DocumentKind = DocumentKind.PDF,
        *,
        pages: list[str] | None = None,
        content: bytes = b"%PDF-1.4 fake",
        status: DocumentStatus = DocumentStatus.QUEUED,
        size_bytes: int | None = None,
    ) -> Document:
        """A document as the upload service would leave it: file on disk, row `queued`."""
        doc_id = str(uuid4())
        path = self.storage.path_for(doc_id, kind)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        if pages is not None:
            self.pdf.pages[path.name] = pages
        now = self.clock.now()
        document = Document(
            id=doc_id,
            filename=f"Datei {doc_id[:4]}.{kind.value}",
            kind=kind,
            size_bytes=size_bytes or len(content),
            sha256=uuid4().hex,
            status=status,
            created_at=now,
            updated_at=now,
        )
        self.repository.insert(document)
        return document

    def reload(self, document: Document) -> Document | None:
        return self.repository.get(document.id)


def build_harness(root: Path, *, embedder: FakeEmbedder | None = None, **limits: int) -> Harness:
    database = Database(root / "app.db")
    database.migrate()
    repository = SqliteDocumentRepository(database)
    storage = LocalFileStorage(root / "uploads")
    spool = JsonlChunkSpool(root / "spool")
    vectors = FakeVectorStore()
    pdf = FakePdfParser()
    embedder = embedder or FakeEmbedder(dim=4)
    clock = FakeClock()
    purge = DocumentPurge(repository, storage, vectors)
    parse = ParseStage(
        spool,
        pdf,
        TextFileParser(),
        NoPageOcr(),
        ParseLimits(
            max_pdf_pages=limits.get("max_pdf_pages", 100),
            max_chars=limits.get("max_chars", 1_000_000),
            batch_pages=limits.get("batch_pages", 2),
            max_failed_batches=limits.get("max_failed_batches", 3),
        ),
    )
    embed = EmbedStage(
        spool, embedder, vectors, EmbedBatching(embed_batch_size=2, write_batch_size=3)
    )
    worker = IngestionWorker(repository, storage, spool, vectors, parse, embed, purge, clock)
    documents = DocumentService(repository, storage, vectors, worker, purge, clock)
    uploads = UploadService(
        repository,
        storage,
        NoopMalwareScanner(),
        worker,
        clock,
        UploadLimits(
            max_bytes=limits.get("max_bytes", 5 * MB),
            max_storage_bytes=limits.get("max_storage_bytes", 20 * MB),
            min_free_bytes=limits.get("min_free_bytes", 0),
        ),
    )
    return Harness(
        root, repository, storage, spool, vectors, pdf, embedder, clock, worker, documents, uploads
    )


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    return build_harness(tmp_path)
