"""Chats, messages and answer streams. Only translation between HTTP and the chat services.

Answer routes are server-sent event streams. Their preconditions run in a dependency, before
the response starts, so every refusal is a normal JSON error with a status code; once the
stream is open, failures arrive as one `error` event.
"""

from collections.abc import AsyncIterator
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent

from docchat.api.answer_stream import answer_stream
from docchat.api.dependencies import AnswerServiceDep, ChatServiceDep, DocumentServiceDep
from docchat.api.schemas.chats import (
    AskIn,
    ChatEnvelopeOut,
    ChatListItemOut,
    ChatListOut,
    ChatOut,
    CreateChatIn,
    MessageListOut,
    MessageOut,
    RegenerateIn,
    StopIn,
    StopOut,
    UpdateChatIn,
)
from docchat.api.schemas.common import ErrorEnvelope
from docchat.api.schemas.documents import DocumentListOut, DocumentOut
from docchat.core.logging import request_id_var
from docchat.domain.enums import Lane
from docchat.services.answer_run import AnswerRun
from docchat.services.answer_service import AnswerOptions, AskCommand

router = APIRouter(prefix="/api/chats", tags=["chats"])

_STREAM_DOC: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "Events `meta`, `status`, `sources`, `delta`, `citation`, then exactly one "
        "`done` or `error` (payloads: Sse* schemas). A `: ping` comment every 15 s.",
        "content": {"text/event-stream": {"schema": {"type": "string"}}},
    }
}


def _errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {status: {"model": ErrorEnvelope} for status in (*statuses, 422)}


def _stream_errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """Refusals before a stream opens are JSON, not events."""
    envelope = {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
    return {
        status: {
            "description": "Refused before the stream opened.",
            "content": {"application/json": envelope},
        }
        for status in (*statuses, 422)
    }


async def _ask(chat_id: UUID, body: AskIn, answers: AnswerServiceDep) -> AnswerRun:
    return await answers.ask(
        AskCommand(
            chat_id=str(chat_id),
            client_message_id=str(body.client_message_id),
            content=body.content,
            options=AnswerOptions(
                model=body.model,
                locale=body.locale,
                effort=body.effort,
                style=body.style,
                request_id=request_id_var.get(),
            ),
            lane=body.comparison.lane if body.comparison else Lane.A,
            comparison_id=str(body.comparison.id) if body.comparison else None,
        )
    )


async def _regenerate(
    chat_id: UUID, assistant_id: UUID, body: RegenerateIn, answers: AnswerServiceDep
) -> AnswerRun:
    options = AnswerOptions(
        model=body.model,
        locale=body.locale,
        effort=body.effort,
        style=body.style,
        request_id=request_id_var.get(),
    )
    return await answers.regenerate(str(chat_id), str(assistant_id), options)


@router.get("", response_model=ChatListOut)
def list_chats(chats: ChatServiceDep) -> ChatListOut:
    """All chats, most recently active first."""
    return ChatListOut(chats=[ChatListItemOut.from_summary(s) for s in chats.list_chats()])


@router.post("", status_code=201, response_model=ChatEnvelopeOut, responses=_errors(404, 409))
def create_chat(body: CreateChatIn, chats: ChatServiceDep) -> ChatEnvelopeOut:
    chat = chats.create(body.scope, [str(d) for d in body.document_ids])
    return ChatEnvelopeOut(chat=ChatOut.from_chat(chat))


@router.get("/{chat_id}", response_model=ChatEnvelopeOut, responses=_errors(404))
def get_chat(chat_id: UUID, chats: ChatServiceDep) -> ChatEnvelopeOut:
    return ChatEnvelopeOut(chat=ChatOut.from_chat(chats.get(str(chat_id))))


@router.patch("/{chat_id}", response_model=ChatEnvelopeOut, responses=_errors(404))
def update_chat(chat_id: UUID, body: UpdateChatIn, chats: ChatServiceDep) -> ChatEnvelopeOut:
    """A new title is the user's and is never replaced automatically."""
    chat = chats.update(
        str(chat_id),
        title=body.title,
        scope=body.scope,
        document_ids=None if body.document_ids is None else [str(d) for d in body.document_ids],
    )
    return ChatEnvelopeOut(chat=ChatOut.from_chat(chat))


@router.delete("/{chat_id}", status_code=204, responses=_errors(404))
async def delete_chat(chat_id: UUID, chats: ChatServiceDep) -> Response:
    """Stops running answers of the chat first."""
    await chats.delete(str(chat_id))
    return Response(status_code=204)


@router.get("/{chat_id}/attachments", response_model=DocumentListOut, responses=_errors(404))
def list_attachments(
    chat_id: UUID, chats: ChatServiceDep, documents: DocumentServiceDep
) -> DocumentListOut:
    """Documents uploaded into this chat, newest first. Poll while any is processing."""
    chats.get(str(chat_id))
    return DocumentListOut(
        documents=[DocumentOut.from_view(v) for v in documents.attachments(str(chat_id))]
    )


@router.delete("/{chat_id}/attachments/{document_id}", status_code=204, responses=_errors(404, 500))
async def remove_attachment(chat_id: UUID, document_id: UUID, chats: ChatServiceDep) -> Response:
    """Removes the document from this chat. One that is neither in the library nor in another
    chat is deleted completely (file, index, cited text)."""
    await chats.detach(str(chat_id), str(document_id))
    return Response(status_code=204)


@router.get("/{chat_id}/messages", response_model=MessageListOut, responses=_errors(404))
def list_messages(chat_id: UUID, chats: ChatServiceDep) -> MessageListOut:
    """All messages, oldest first."""
    result = chats.messages(str(chat_id))
    return MessageListOut(
        messages=[MessageOut.from_message(m, result.existing_document_ids) for m in result.messages]
    )


@router.post(
    "/{chat_id}/messages",
    response_class=EventSourceResponse,
    responses={**_STREAM_DOC, **_stream_errors(404, 409, 429, 503)},
)
async def ask(run: Annotated[AnswerRun, Depends(_ask)]) -> AsyncIterator[ServerSentEvent]:
    """Asks a question and streams the answer. Without an API key the stream carries the
    sources only (`done.status = sources_only`)."""
    async for event in answer_stream(run):
        yield event


@router.post(
    "/{chat_id}/messages/{assistant_id}/regenerate",
    response_class=EventSourceResponse,
    responses={**_STREAM_DOC, **_stream_errors(404, 409, 429, 503)},
)
async def regenerate(
    run: Annotated[AnswerRun, Depends(_regenerate)],
) -> AsyncIterator[ServerSentEvent]:
    """Replaces an answer to the latest question (same lane, same message id)."""
    async for event in answer_stream(run):
        yield event


@router.post("/{chat_id}/messages/{assistant_id}/prefer", status_code=204, responses=_errors(404))
def prefer(chat_id: UUID, assistant_id: UUID, chats: ChatServiceDep) -> Response:
    """Keeps this answer of a comparison; only the kept answer goes into later history."""
    chats.prefer(str(chat_id), str(assistant_id))
    return Response(status_code=204)


@router.post("/{chat_id}/stop", status_code=202, response_model=StopOut, responses=_errors(404))
def stop(chat_id: UUID, chats: ChatServiceDep, body: StopIn | None = None) -> StopOut:
    """Second safety net next to aborting the request: stops the lane's answer, which is then
    saved as `stopped`."""
    return StopOut(stopped=chats.stop(str(chat_id), body.lane if body else None))
