from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from docchat.api.schemas.documents import NoticeOut
from docchat.domain.chat_models import Chat, ChatSummary, Citation, Message, SourceSnapshot
from docchat.domain.enums import (
    AnswerStyle,
    ChatScope,
    Effort,
    Lane,
    Locale,
    MessageRole,
    MessageStatus,
    SourcesMode,
    TitleSource,
)
from docchat.domain.errors import ErrorCode
from docchat.domain.models import Notice
from docchat.domain.usage import TokenUsage

# Hard cap for the request body only; the service answers QUESTION_TOO_LONG above its limit.
_CONTENT_CAP = 16_000


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


def notices_out(notices: tuple[Notice, ...]) -> list[NoticeOut]:
    return [NoticeOut(code=n.code, params=dict(n.params)) for n in notices]


# Chats


class CreateChatIn(_In):
    scope: ChatScope = ChatScope.ALL
    document_ids: list[UUID] = Field(default_factory=list, description="Only for `selected`.")


class UpdateChatIn(_In):
    title: str | None = Field(default=None, max_length=1000, description="1 to 120 characters.")
    scope: ChatScope | None = None
    document_ids: list[UUID] | None = None


class ChatOut(BaseModel):
    id: str
    title: str | None = Field(description="None: show the localized 'New chat'. Render as text.")
    title_source: TitleSource
    scope: ChatScope
    document_ids: list[str]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_chat(cls, chat: Chat) -> "ChatOut":
        return cls(
            id=chat.id,
            title=chat.title,
            title_source=chat.title_source,
            scope=chat.scope,
            document_ids=list(chat.document_ids),
            created_at=chat.created_at,
            updated_at=chat.updated_at,
        )


class ChatListItemOut(ChatOut):
    message_count: int

    @classmethod
    def from_summary(cls, summary: ChatSummary) -> "ChatListItemOut":
        return cls(
            **ChatOut.from_chat(summary.chat).model_dump(), message_count=summary.message_count
        )


class ChatEnvelopeOut(BaseModel):
    chat: ChatOut


class ChatListOut(BaseModel):
    chats: list[ChatListItemOut]


# Messages


class SourceOut(BaseModel):
    id: str = Field(description="Chunk id; citations refer to it as `source_id`.")
    index: int = Field(description="1-based number of the source chip.")
    document_id: str
    filename: str
    page: int | None
    snippet: str
    deleted: bool = Field(description="The document is gone; show the snapshot, open nothing.")

    @classmethod
    def from_snapshot(cls, source: SourceSnapshot, *, deleted: bool = False) -> "SourceOut":
        return cls(
            id=source.id,
            index=source.index,
            document_id=source.document_id,
            filename=source.filename,
            page=source.page,
            snippet=source.snippet,
            deleted=deleted,
        )


class CitationOut(BaseModel):
    source_id: str
    block_start: int
    block_end: int = Field(description="Exclusive.")
    cited_text: str
    char_offset: int = Field(description="Position in the answer text where the chip goes.")

    @classmethod
    def from_citation(cls, citation: Citation) -> "CitationOut":
        return cls(
            source_id=citation.source_id,
            block_start=citation.block_start,
            block_end=citation.block_end,
            cited_text=citation.cited_text,
            char_offset=citation.char_offset,
        )


class UsageOut(BaseModel):
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int

    @classmethod
    def from_usage(cls, usage: TokenUsage | None) -> "UsageOut | None":
        if usage is None:
            return None
        return cls(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_input_tokens=usage.cache_read_input_tokens,
            cache_creation_input_tokens=usage.cache_creation_input_tokens,
        )


class LatencyOut(BaseModel):
    ttft: int | None = Field(description="Milliseconds until the first text.")
    total: int | None


class MessageOut(BaseModel):
    id: str
    role: MessageRole
    content: str = Field(description="Markdown without citation markers.")
    status: MessageStatus
    parent_id: str | None
    client_message_id: str | None
    error_code: ErrorCode | None
    error_request_id: str | None = Field(description="Request of a failed answer, for the logs.")
    model: str | None = Field(description="The model that actually answered.")
    effort: Effort | None
    lane: Lane | None
    comparison_id: str | None
    is_preferred: bool
    sources: list[SourceOut]
    sources_mode: SourcesMode | None
    citations: list[CitationOut]
    notices: list[NoticeOut]
    usage: UsageOut | None
    cost_usd: float | None
    latency_ms: LatencyOut
    created_at: datetime

    @classmethod
    def from_message(cls, m: Message, existing_documents: frozenset[str]) -> "MessageOut":
        return cls(
            id=m.id,
            role=m.role,
            content=m.content,
            status=m.status,
            parent_id=m.parent_id,
            client_message_id=m.client_message_id,
            error_code=m.error_code,
            error_request_id=m.error_request_id,
            model=m.model,
            effort=m.effort,
            lane=m.lane,
            comparison_id=m.comparison_id,
            is_preferred=m.is_preferred,
            sources=[
                SourceOut.from_snapshot(s, deleted=s.document_id not in existing_documents)
                for s in m.sources
            ],
            sources_mode=m.sources_mode,
            citations=[CitationOut.from_citation(c) for c in m.citations],
            notices=notices_out(m.notices),
            usage=UsageOut.from_usage(m.usage),
            cost_usd=m.cost_usd,
            latency_ms=LatencyOut(ttft=m.ttft_ms, total=m.total_ms),
            created_at=m.created_at,
        )


class MessageListOut(BaseModel):
    messages: list[MessageOut]


# Answers


class ComparisonIn(_In):
    id: UUID
    lane: Lane


class AskIn(_In):
    client_message_id: UUID = Field(description="Created by the client; a repeat is ignored.")
    content: str = Field(max_length=_CONTENT_CAP)
    model: str
    effort: Effort | None = None
    style: AnswerStyle = AnswerStyle.CONCISE
    locale: Locale
    comparison: ComparisonIn | None = None


class RegenerateIn(_In):
    model: str | None = Field(default=None, description="Default: the answer's model.")
    effort: Effort | None = None
    style: AnswerStyle = AnswerStyle.CONCISE
    locale: Locale


class StopIn(_In):
    lane: Lane | None = Field(default=None, description="Without a lane every lane stops.")


class StopOut(BaseModel):
    stopped: list[Lane]
