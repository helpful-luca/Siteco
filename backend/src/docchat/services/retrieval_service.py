"""Chooses the passages an answer is based on.

SQLite decides which documents may be searched (only `ready` ones in the chat's scope);
LanceDB is just the index. Small scopes go to the model completely (full-context mode), so
"summarize the document" works; larger ones use hybrid search.
"""

import asyncio
from collections.abc import Collection
from dataclasses import dataclass

from docchat.domain.chat_models import Chat
from docchat.domain.enums import ChatScope, DocumentStatus, SourcesMode
from docchat.domain.errors import AppError, ErrorCode, NoticeCode
from docchat.domain.models import Chunk, Document, Notice
from docchat.domain.ports import DocumentRepository, Embedder, VectorStore
from docchat.domain.retrieval import fits_full_context, is_summary_request, select_sources

DOCUMENTS_NOT_READY_RETRY_S = 3
_PROCESSING = frozenset(
    {
        DocumentStatus.SCANNING,
        DocumentStatus.QUEUED,
        DocumentStatus.PARSING,
        DocumentStatus.EMBEDDING,
    }
)


@dataclass(frozen=True)
class RetrievalSettings:
    candidates: int = 20
    top_k: int = 8
    per_document_cap: int = 5
    full_context_max_tokens: int = 20_000


@dataclass(frozen=True)
class RetrievalPlan:
    """Decided before the stream opens, from SQLite only."""

    documents: tuple[Document, ...]  # ready documents in scope, in library order
    mode: SourcesMode
    notices: tuple[Notice, ...]


@dataclass(frozen=True)
class Retrieved:
    mode: SourcesMode
    chunks: tuple[Chunk, ...]
    documents: dict[str, Document]
    notices: tuple[Notice, ...]


class RetrievalService:
    def __init__(
        self,
        documents: DocumentRepository,
        vectors: VectorStore,
        embedder: Embedder,
        settings: RetrievalSettings,
    ) -> None:
        self._documents = documents
        self._vectors = vectors
        self._embedder = embedder
        self._settings = settings

    def plan(self, chat: Chat) -> RetrievalPlan:
        """Raises NO_DOCUMENTS or DOCUMENTS_NOT_READY when there is nothing to search yet."""
        attached = {d.id for d in self._documents.list_attachments(chat.id)}
        selected = set(chat.document_ids)

        def in_scope(document: Document) -> bool:
            if document.id in attached:  # uploaded into this chat: always searched here
                return True
            if not document.in_library:  # another chat's attachment
                return False
            return chat.scope is ChatScope.ALL or document.id in selected

        visible = [d for d in self._documents.list_visible() if in_scope(d)]
        ready = tuple(d for d in visible if d.status is DocumentStatus.READY)
        processing = sum(1 for d in visible if d.status in _PROCESSING)
        if not ready:
            if processing:
                raise AppError(
                    ErrorCode.DOCUMENTS_NOT_READY, retry_after=DOCUMENTS_NOT_READY_RETRY_S
                )
            raise AppError(ErrorCode.NO_DOCUMENTS)
        notices = (Notice(NoticeCode.SOURCES_PARTIAL, {"count": processing}),) if processing else ()
        full = fits_full_context(
            (d.char_count or 0 for d in ready), self._settings.full_context_max_tokens
        )
        mode = SourcesMode.FULL_CONTEXT if full else SourcesMode.RETRIEVAL
        return RetrievalPlan(ready, mode, notices)

    def _still_ready(self, plan: RetrievalPlan) -> tuple[Document, ...]:
        """The plan was made before the stream opened; a document deleted since then is out."""
        ready = {d.id for d in self._documents.list_by_status(DocumentStatus.READY)}
        return tuple(d for d in plan.documents if d.id in ready)

    async def retrieve(self, plan: RetrievalPlan, query: str, question: str) -> Retrieved:
        documents = await asyncio.to_thread(self._still_ready, plan)
        ids = [d.id for d in documents]
        notices = list(plan.notices)
        if plan.mode is SourcesMode.FULL_CONTEXT:
            chunks = await asyncio.to_thread(self._vectors.chunks_of, ids)
        else:
            chunks = await self._rank(ids, query, self._settings.top_k)
            if is_summary_request(question):
                notices.append(Notice(NoticeCode.SUMMARY_PARTIAL))
        allowed = {d.id: d for d in documents}
        # The index may still hold chunks of a document deleted a moment ago: SQLite wins.
        kept = tuple(c for c in chunks if c.document_id in allowed)
        return Retrieved(plan.mode, kept, allowed, tuple(notices))

    async def search(
        self, query: str, top_k: int, document_ids: Collection[str] | None = None
    ) -> Retrieved:
        """The chat's hybrid search without a chat, for other interfaces (the MCP server).
        Always ranked, never full-context. Only ready documents, optionally narrowed to
        `document_ids`; unknown or not ready ids are ignored. Library documents only: chat
        attachments belong to their chat."""
        documents = await asyncio.to_thread(self._ready_documents, document_ids)
        ids = [d.id for d in documents]
        allowed = {d.id: d for d in documents}
        chunks = await self._rank(ids, query, top_k) if ids else []
        kept = tuple(c for c in chunks if c.document_id in allowed)
        return Retrieved(SourcesMode.RETRIEVAL, kept, allowed, ())

    def _ready_documents(self, only: Collection[str] | None) -> list[Document]:
        ready = [d for d in self._documents.list_library() if d.status is DocumentStatus.READY]
        return ready if only is None else [d for d in ready if d.id in set(only)]

    async def _rank(self, ids: list[str], query: str, top_k: int) -> list[Chunk]:
        vector = await asyncio.to_thread(self._embedder.embed_query, query)
        ranked = await asyncio.to_thread(
            self._vectors.search, query, vector, ids, self._settings.candidates
        )
        return select_sources(
            ranked,
            top_k=top_k,
            per_document_cap=self._settings.per_document_cap,
            multiple_documents=len(ids) > 1,
        )
