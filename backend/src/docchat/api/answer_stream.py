"""Turns the events of an answer run into server-sent events."""

from collections.abc import AsyncIterator

from fastapi.sse import ServerSentEvent

from docchat.api.schemas.answer_events import (
    SseCitation,
    SseDelta,
    SseDone,
    SseDoneChat,
    SseError,
    SseMeta,
    SseSources,
    SseStatus,
)
from docchat.api.schemas.chats import CitationOut, LatencyOut, SourceOut, UsageOut, notices_out
from docchat.api.schemas.common import ErrorBody
from docchat.core.logging import request_id_var
from docchat.domain.errors import ERROR_SPECS
from docchat.services.answer_run import AnswerRun
from docchat.services.run_events import (
    CitationEvent,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    MetaEvent,
    RunEvent,
    SourcesEvent,
    StatusEvent,
)


def _meta(event: MetaEvent) -> SseMeta:
    return SseMeta(
        request_id=request_id_var.get(),
        chat_id=event.chat_id,
        user_message_id=event.user_message_id,
        assistant_message_id=event.assistant_message_id,
        model=event.model,
        lane=event.lane,
        comparison_id=event.comparison_id,
    )


def _done(event: DoneEvent) -> SseDone:
    return SseDone(
        status=event.status,
        stop_reason=event.stop_reason,
        usage=UsageOut.from_usage(event.usage),
        cost_usd=event.cost_usd,
        latency_ms=LatencyOut(ttft=event.ttft_ms, total=event.total_ms),
        notices=notices_out(event.notices),
        chat=SseDoneChat(
            id=event.chat.id, title=event.chat.title, updated_at=event.chat.updated_at
        ),
    )


def _error(event: ErrorEvent) -> SseError:
    return SseError(
        error=ErrorBody(
            code=event.code,
            message=event.code.value,
            retryable=ERROR_SPECS[event.code].retryable,
            retry_after=event.retry_after,
            request_id=request_id_var.get(),
            params=event.params or {},
        ),
        partial=event.partial,
        stage=event.stage,
    )


def to_sse(event: RunEvent) -> ServerSentEvent:
    if isinstance(event, MetaEvent):
        return ServerSentEvent(event="meta", data=_meta(event))
    if isinstance(event, StatusEvent):
        return ServerSentEvent(
            event="status", data=SseStatus(phase=event.phase, attempt=event.attempt)
        )
    if isinstance(event, SourcesEvent):
        sources = SseSources(
            mode=event.mode,
            sources=[SourceOut.from_snapshot(s) for s in event.sources],
            notices=notices_out(event.notices),
        )
        return ServerSentEvent(event="sources", data=sources)
    if isinstance(event, DeltaEvent):
        return ServerSentEvent(event="delta", data=SseDelta(text=event.text))
    if isinstance(event, CitationEvent):
        citation = SseCitation(**CitationOut.from_citation(event.citation).model_dump())
        return ServerSentEvent(event="citation", data=citation)
    if isinstance(event, DoneEvent):
        return ServerSentEvent(event="done", data=_done(event))
    return ServerSentEvent(event="error", data=_error(event))


async def answer_stream(run: AnswerRun) -> AsyncIterator[ServerSentEvent]:
    """Leaving early (client gone) closes `run.events()`, which marks the answer interrupted."""
    events = run.events()
    try:
        async for event in events:
            yield to_sse(event)
    finally:
        await events.aclose()
