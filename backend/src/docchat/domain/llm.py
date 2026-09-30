"""Provider-neutral model request and stream events.

The events are block level, like Claude's stream: text arrives in blocks, citations are
attached to the current block, and `TextBlockEnd` closes it. `AnswerAssembler` turns that
into one answer text plus citations with character offsets.
"""

from dataclasses import dataclass

from docchat.domain.enums import AnswerStyle, Effort, Locale
from docchat.domain.errors import ErrorCode
from docchat.domain.history import HistoryTurn
from docchat.domain.usage import ModelUsage


@dataclass(frozen=True)
class SearchResult:
    """One chunk as the model sees it. `sentences` become one citable text block each."""

    source: str  # the chunk id; comes back unchanged in every citation
    title: str
    sentences: tuple[str, ...]


@dataclass(frozen=True)
class LLMRequest:
    model: str
    effort: Effort | None
    history: tuple[HistoryTurn, ...]
    search_results: tuple[SearchResult, ...]
    question: str
    ui_language: Locale
    answer_style: AnswerStyle
    max_tokens: int
    allow_fallbacks: bool = True  # off in the comparison mode, so both columns stay honest


@dataclass(frozen=True)
class RequestStarted:
    """The request really goes out now (after waiting for a free slot). The first-token
    limit counts from here, so queueing behind other answers is not a model timeout."""


@dataclass(frozen=True)
class ModelResolved:
    """The model that is actually answering (differs after a server-side fallback)."""

    model: str


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class CitationDelta:
    """A citation of the current text block, identified by `source`, never by position."""

    source: str
    block_start: int
    block_end: int
    cited_text: str


@dataclass(frozen=True)
class TextBlockEnd:
    pass


@dataclass(frozen=True)
class UsageReported:
    """Usage so far (cumulative). Reported early, so a stopped answer can still be billed."""

    parts: tuple[ModelUsage, ...]


@dataclass(frozen=True)
class Completed:
    stop_reason: str  # end_turn, max_tokens, refusal, stop_sequence, ...


LLMEvent = (
    RequestStarted
    | ModelResolved
    | TextDelta
    | CitationDelta
    | TextBlockEnd
    | UsageReported
    | Completed
)


class LLMError(Exception):
    """A model call failed. `code` is one of the LLM_* error codes."""

    def __init__(
        self,
        code: ErrorCode,
        *,
        retry_after: int | None = None,
        upstream_request_id: str | None = None,
    ) -> None:
        super().__init__(code.value)
        self.code = code
        self.retry_after = retry_after
        self.upstream_request_id = upstream_request_id
