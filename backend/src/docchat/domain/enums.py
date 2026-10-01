from enum import StrEnum


class ComponentStatus(StrEnum):
    LOADING = "loading"
    OK = "ok"
    FAILED = "failed"


class LlmStatus(StrEnum):
    MISSING_KEY = "missing_key"
    UNCHECKED = "unchecked"
    OK = "ok"
    INVALID_KEY = "invalid_key"
    NEEDS_WORKSPACE = "needs_workspace"  # the key works only with a workspace id


class DocumentKind(StrEnum):
    PDF = "pdf"
    TXT = "txt"
    MD = "md"
    HTML = "html"  # read as text, never rendered


class DocumentStatus(StrEnum):
    """`scanning` belongs to the malware check (WP-B). `deleting` hides a row until it is gone."""

    SCANNING = "scanning"
    QUEUED = "queued"
    PARSING = "parsing"
    EMBEDDING = "embedding"
    READY = "ready"
    FAILED = "failed"
    DELETING = "deleting"


class ChatScope(StrEnum):
    """`all`: every `ready` document at question time. `selected`: the chosen ones."""

    ALL = "all"
    SELECTED = "selected"


class TitleSource(StrEnum):
    AUTO = "auto"
    USER = "user"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class MessageStatus(StrEnum):
    """Only `complete` and `truncated` answers go into the history sent to the model."""

    STREAMING = "streaming"
    COMPLETE = "complete"
    TRUNCATED = "truncated"
    STOPPED = "stopped"
    INTERRUPTED = "interrupted"
    REFUSED = "refused"
    ERROR = "error"
    SOURCES_ONLY = "sources_only"


class Lane(StrEnum):
    """Single answers always use `a`; the comparison mode adds `b`."""

    A = "a"
    B = "b"


class Effort(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class AnswerStyle(StrEnum):
    CONCISE = "concise"
    DETAILED = "detailed"


class Locale(StrEnum):
    DE = "de"
    EN = "en"


class Theme(StrEnum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class SourcesMode(StrEnum):
    """How the sources of an answer were chosen."""

    RETRIEVAL = "retrieval"
    FULL_CONTEXT = "full_context"
    RETRIEVAL_ONLY = "retrieval_only"


class SearchMode(StrEnum):
    """How chunks are ranked. Answers always use hybrid; the eval compares all three."""

    HYBRID = "hybrid"  # vector and BM25, fused by reciprocal rank
    DENSE = "dense"  # vector only
    BM25 = "bm25"  # full text only


class RunPhase(StrEnum):
    RETRIEVING = "retrieving"
    GENERATING = "generating"
    RETRYING = "retrying"


class ErrorStage(StrEnum):
    RETRIEVAL = "retrieval"
    LLM = "llm"
    PERSIST = "persist"
