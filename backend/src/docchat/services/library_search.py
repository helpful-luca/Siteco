"""Read access to the library for other interfaces than the chat (the MCP server).

No answer generation and no key: it only lists ready documents and returns passages from the
same retrieval the chat uses."""

from collections.abc import Collection
from dataclasses import dataclass

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import DocumentRepository
from docchat.services.retrieval_service import RetrievalService

MAX_TOP_K = 10
MAX_QUERY_CHARS = 500
MAX_DOCUMENT_IDS = 50


@dataclass(frozen=True)
class LibraryDocument:
    id: str
    filename: str
    kind: DocumentKind
    pages: int | None


@dataclass(frozen=True)
class Passage:
    source_id: str  # the chunk id: stable for as long as the document stays indexed
    document_id: str
    filename: str
    page: int | None
    heading: str
    text: str


class LibrarySearch:
    def __init__(self, documents: DocumentRepository, retrieval: RetrievalService) -> None:
        self._documents = documents
        self._retrieval = retrieval

    def list_documents(self) -> list[LibraryDocument]:
        return [
            LibraryDocument(d.id, d.filename, d.kind, d.page_count)
            for d in self._documents.list_visible()
            if d.status is DocumentStatus.READY
        ]

    async def search(
        self, query: str, top_k: int = 5, document_ids: Collection[str] | None = None
    ) -> list[Passage]:
        query = query.strip()
        if not query:
            raise AppError(ErrorCode.VALIDATION_ERROR, "query must not be empty")
        if len(query) > MAX_QUERY_CHARS:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, f"query is longer than {MAX_QUERY_CHARS} characters"
            )
        if document_ids is not None and len(document_ids) > MAX_DOCUMENT_IDS:
            raise AppError(ErrorCode.VALIDATION_ERROR, f"at most {MAX_DOCUMENT_IDS} document_ids")
        found = await self._retrieval.search(query, max(1, min(top_k, MAX_TOP_K)), document_ids)
        return [
            Passage(
                c.chunk_id,
                c.document_id,
                found.documents[c.document_id].filename,
                c.page,
                c.heading,
                c.text,
            )
            for c in found.chunks
        ]
