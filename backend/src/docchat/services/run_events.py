"""What one answer run tells its listener, in order (annex 11, 3.3):

    meta, status(retrieving), sources, status(generating), delta/citation..., done | error

Exactly one terminal event (`done` or `error`) ends every run. The API layer turns these into
SSE; they carry no HTTP or framework types.
"""

from dataclasses import dataclass
from typing import Any

from docchat.domain.chat_models import Chat, Citation, SourceSnapshot
from docchat.domain.enums import ErrorStage, Lane, MessageStatus, RunPhase, SourcesMode
from docchat.domain.errors import ErrorCode
from docchat.domain.models import Notice
from docchat.domain.usage import TokenUsage


@dataclass(frozen=True)
class MetaEvent:
    chat_id: str
    user_message_id: str
    assistant_message_id: str
    model: str
    lane: Lane
    comparison_id: str | None


@dataclass(frozen=True)
class StatusEvent:
    phase: RunPhase
    attempt: int


@dataclass(frozen=True)
class SourcesEvent:
    mode: SourcesMode
    sources: tuple[SourceSnapshot, ...]
    notices: tuple[Notice, ...]


@dataclass(frozen=True)
class DeltaEvent:
    text: str


@dataclass(frozen=True)
class CitationEvent:
    citation: Citation


@dataclass(frozen=True)
class DoneEvent:
    status: MessageStatus
    stop_reason: str | None
    usage: TokenUsage | None
    cost_usd: float
    ttft_ms: int | None
    total_ms: int
    notices: tuple[Notice, ...]
    chat: Chat


@dataclass(frozen=True)
class ErrorEvent:
    code: ErrorCode
    partial: bool
    stage: ErrorStage
    retry_after: int | None = None
    params: dict[str, Any] | None = None


RunEvent = (
    MetaEvent | StatusEvent | SourcesEvent | DeltaEvent | CitationEvent | DoneEvent | ErrorEvent
)
