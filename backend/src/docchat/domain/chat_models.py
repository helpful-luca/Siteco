"""Chats and messages. Frozen dataclasses, no I/O."""

from dataclasses import dataclass
from datetime import datetime

from docchat.domain.enums import (
    ChatScope,
    Effort,
    Lane,
    MessageRole,
    MessageStatus,
    SourcesMode,
    TitleSource,
)
from docchat.domain.errors import ErrorCode
from docchat.domain.models import Notice
from docchat.domain.usage import TokenUsage


@dataclass(frozen=True)
class Chat:
    id: str
    scope: ChatScope
    created_at: datetime
    updated_at: datetime
    title: str | None = None  # None: the UI shows its localized "New chat"
    title_source: TitleSource = TitleSource.AUTO
    document_ids: tuple[str, ...] = ()  # only for scope `selected`


@dataclass(frozen=True)
class ChatSummary:
    chat: Chat
    message_count: int


@dataclass(frozen=True)
class SourceSnapshot:
    """What an answer was based on, kept even if the document is deleted later."""

    id: str  # chunk id, sent to Claude as the search result `source`
    index: int  # 1-based number of the source chip
    document_id: str
    filename: str
    page: int | None
    snippet: str


@dataclass(frozen=True)
class Citation:
    source_id: str
    block_start: int
    block_end: int  # exclusive
    cited_text: str
    char_offset: int  # position in the answer text where the chip goes


@dataclass(frozen=True)
class Message:
    id: str
    chat_id: str
    role: MessageRole
    created_at: datetime
    content: str = ""
    status: MessageStatus = MessageStatus.COMPLETE
    parent_id: str | None = None
    client_message_id: str | None = None
    error_code: ErrorCode | None = None
    # The request that failed, so its id can still be copied after a reload.
    error_request_id: str | None = None
    model: str | None = None
    effort: Effort | None = None
    lane: Lane | None = None
    comparison_id: str | None = None
    is_preferred: bool = True
    sources: tuple[SourceSnapshot, ...] = ()
    sources_mode: SourcesMode | None = None
    citations: tuple[Citation, ...] = ()
    notices: tuple[Notice, ...] = ()
    usage: TokenUsage | None = None
    cost_usd: float | None = None
    ttft_ms: int | None = None
    total_ms: int | None = None
