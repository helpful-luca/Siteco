"""Chat use cases: list, create, rename, change scope, delete, read messages."""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, replace

from docchat.domain.chat_models import Chat, ChatSummary, Message
from docchat.domain.enums import ChatScope, DocumentStatus, Lane, MessageRole, TitleSource
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import ChatRepository, Clock, DocumentRepository
from docchat.domain.redaction import without_text_of
from docchat.services.disk_erasure import DiskErasure
from docchat.services.document_service import DocumentService
from docchat.services.run_registry import RunRegistry

log = logging.getLogger("docchat.chats")

TITLE_MAX_CHARS = 120
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class ChatMessages:
    messages: list[Message]
    # Documents that still exist; sources of other documents are shown as deleted.
    existing_document_ids: frozenset[str]


def _clean_title(title: str) -> str:
    cleaned = " ".join(_CONTROL.sub(" ", title).split())
    if not 1 <= len(cleaned) <= TITLE_MAX_CHARS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "Title must have 1 to 120 characters.",
            details=[{"loc": ["body", "title"], "type": "string_length"}],
        )
    return cleaned


class ChatService:
    def __init__(
        self,
        chats: ChatRepository,
        documents: DocumentRepository,
        runs: RunRegistry,
        clock: Clock,
        erasure: DiskErasure,
        library: DocumentService,
        *,
        max_chats: int,
    ) -> None:
        self._erasure = erasure
        self._library = library
        self._chats = chats
        self._documents = documents
        self._runs = runs
        self._clock = clock
        self._max_chats = max_chats

    def list_chats(self) -> list[ChatSummary]:
        return self._chats.list_chats()

    def get(self, chat_id: str) -> Chat:
        chat = self._chats.get_chat(chat_id)
        if chat is None:
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        return chat

    def _selection(self, scope: ChatScope, document_ids: list[str] | None) -> tuple[str, ...]:
        if scope is ChatScope.ALL:
            return ()
        ids: tuple[str, ...] = tuple(dict.fromkeys(document_ids or []))
        if not ids:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "A selected scope needs at least one document.",
                details=[{"loc": ["body", "document_ids"], "type": "too_short"}],
            )
        library = {d.id for d in self._documents.list_library()}
        missing = [d for d in ids if d not in library]
        if missing:
            raise AppError(ErrorCode.NOT_FOUND, params={"document_ids": missing})
        return ids

    def create(self, scope: ChatScope, document_ids: list[str] | None = None) -> Chat:
        if self._chats.count_chats() >= self._max_chats:
            raise AppError(ErrorCode.CHAT_LIMIT, params={"max": self._max_chats})
        now = self._clock.now()
        chat = Chat(
            id=str(uuid.uuid4()),
            scope=scope,
            created_at=now,
            updated_at=now,
            document_ids=self._selection(scope, document_ids),
        )
        self._chats.insert_chat(chat)
        log.info("chat_created", extra={"chat_id": chat.id, "scope": scope.value})
        return chat

    def update(
        self,
        chat_id: str,
        *,
        title: str | None = None,
        scope: ChatScope | None = None,
        document_ids: list[str] | None = None,
    ) -> Chat:
        """Only the given fields change. A new title is the user's and is never overwritten."""
        chat = self.get(chat_id)
        if title is not None:
            chat = replace(chat, title=_clean_title(title), title_source=TitleSource.USER)
        if scope is not None or document_ids is not None:
            new_scope = scope or chat.scope
            if scope is None and new_scope is ChatScope.ALL:
                new_scope = ChatScope.SELECTED  # sending only ids means "these documents"
            chat = replace(
                chat, scope=new_scope, document_ids=self._selection(new_scope, document_ids)
            )
        chat = replace(chat, updated_at=self._clock.now())
        if not self._chats.update_chat(chat):
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        return chat

    def stop(self, chat_id: str, lane: Lane | None = None) -> list[Lane]:
        """Stops running answers of the chat (one lane or all). Returns the stopped lanes."""
        self.get(chat_id)
        return self._runs.stop(chat_id, lane)

    def prefer(self, chat_id: str, assistant_id: str) -> None:
        """Keep this answer of a comparison. Only the kept one goes into the history of later
        questions (annex 11, 1.3)."""
        self.get(chat_id)
        answer = self._chats.get_message(assistant_id)
        if (
            answer is None
            or answer.chat_id != chat_id
            or answer.role is not MessageRole.ASSISTANT
            or answer.comparison_id is None
        ):
            raise AppError(ErrorCode.NOT_FOUND)
        self._chats.set_preferred(answer.comparison_id, answer.id)
        log.info("answer_preferred", extra={"chat_id": chat_id, "message_id": answer.id})

    async def delete(self, chat_id: str) -> None:
        """Running answers are stopped first, so none of them writes into a deleted chat.
        Documents uploaded only into this chat go with it, as forensically as a delete in
        the library (files, index, cited text)."""
        self.get(chat_id)
        await self._runs.stop_and_wait(chat_id)
        if not await self._delete_with_attachments(chat_id):
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        await self._erasure.after_documents()
        log.info("chat_deleted", extra={"chat_id": chat_id})

    async def detach(self, chat_id: str, document_id: str) -> None:
        """Removes a document from the chat; one that is in no library and no other chat is
        deleted like a library delete."""
        self.get(chat_id)
        if not await asyncio.to_thread(self._documents.detach, chat_id, document_id):
            raise AppError(ErrorCode.NOT_FOUND)
        if await self._purge_unreferenced([document_id]):
            await self._erasure.after_documents()
        log.info("attachment_removed", extra={"chat_id": chat_id, "document_id": document_id})

    async def _purge_unreferenced(self, candidates: list[str] | None) -> int:
        """Deletes the candidates that no chat and not the library holds. Not erased here."""
        purged = 0
        for document_id in await asyncio.to_thread(self._documents.unreferenced, candidates):
            try:
                await self._library.delete(document_id, erase=False)
                purged += 1
            except AppError as exc:
                if exc.code is not ErrorCode.NOT_FOUND:  # deleted meanwhile
                    raise
        return purged

    async def _delete_with_attachments(self, chat_id: str) -> bool:
        """Not erased on disk here; the caller erases once. The sweep after the delete covers
        every document no chat and not the library holds, so a file that arrived in the chat
        while it was being deleted goes as well (uploads attach in the same transaction as
        their row, so nothing else is ever unreferenced)."""
        if not await asyncio.to_thread(self._chats.delete_chat, chat_id):
            return False
        await self._purge_unreferenced(None)
        return True

    async def delete_if_idle(self, chat_id: str) -> bool:
        """For automatic deletion: only a chat without a running answer, and no answer can
        start while it is being deleted (the check and the delete are one step for the
        registry). Not erased on disk here; the caller erases once for a whole sweep."""
        if not self._runs.close_if_idle(chat_id):
            return False
        try:
            return await self._delete_with_attachments(chat_id)
        finally:
            self._runs.reopen(chat_id)

    def messages(self, chat_id: str) -> ChatMessages:
        """Sources of deleted documents come without their text, also when an answer was saved
        while its document was being deleted (the stored snapshot is redacted at startup)."""
        self.get(chat_id)
        existing = frozenset(
            d.id for d in self._documents.list_visible() if d.status is not DocumentStatus.DELETING
        )
        messages = [
            without_text_of(m, {s.document_id for s in m.sources} - existing)
            for m in self._chats.list_messages(chat_id)
        ]
        return ChatMessages(messages, existing)

    def recover(self) -> int:
        """Startup: answers a crash left `streaming` become `interrupted`."""
        count = self._chats.interrupt_streaming()
        if count:
            log.info("answers_interrupted_by_restart", extra={"count": count})
        return count
