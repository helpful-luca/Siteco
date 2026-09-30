"""Payloads of the answer stream (annex 11, 3.3). One model per SSE event name.

The stream is `text/event-stream`; these models only exist so the frontend gets exact types
from the contract.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from docchat.api.schemas.chats import CitationOut, LatencyOut, SourceOut, UsageOut
from docchat.api.schemas.common import ErrorBody
from docchat.api.schemas.documents import NoticeOut
from docchat.domain.enums import ErrorStage, Lane, MessageStatus, RunPhase, SourcesMode


class SseMeta(BaseModel):
    """`event: meta`, always first."""

    request_id: str
    chat_id: str
    user_message_id: str
    assistant_message_id: str
    model: str = Field(description="The requested model; a switch shows as MODEL_SWITCHED.")
    lane: Lane
    comparison_id: str | None


class SseStatus(BaseModel):
    """`event: status`: retrieving, generating, retrying (before the first delta only)."""

    phase: RunPhase
    attempt: int


class SseSources(BaseModel):
    """`event: sources`: what the answer is based on, numbered for the chips."""

    mode: SourcesMode
    sources: list[SourceOut]
    notices: list[NoticeOut]


class SseDelta(BaseModel):
    """`event: delta`: the next piece of answer text."""

    text: str


class SseCitation(CitationOut):
    """`event: citation`: sent when its text block ends; `char_offset` is final."""


class SseDoneChat(BaseModel):
    id: str
    title: str | None
    updated_at: datetime


class SseDone(BaseModel):
    """`event: done`: the terminal event of a finished, stopped or sources-only answer."""

    status: MessageStatus
    stop_reason: str | None
    usage: UsageOut | None
    cost_usd: float
    latency_ms: LatencyOut
    notices: list[NoticeOut]
    chat: SseDoneChat


class SseError(BaseModel):
    """`event: error`: the terminal event of a failed answer."""

    error: ErrorBody
    partial: bool = Field(description="Text was streamed and stays visible as incomplete.")
    stage: ErrorStage


SSE_EVENT_MODELS: tuple[type[BaseModel], ...] = (
    SseMeta,
    SseStatus,
    SseSources,
    SseDelta,
    SseCitation,
    SseDone,
    SseError,
)
