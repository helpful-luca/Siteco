"""Core entities of the library. Frozen dataclasses, no I/O."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import ErrorCode, NoticeCode

# (x, y, width, height) in 0..1 of the page's CropBox, origin top left, page rotation applied.
Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class Notice:
    """A hint that is not an error, translated in the UI via `notices.<code>`."""

    code: NoticeCode
    params: Mapping[str, int | str] = field(default_factory=dict)


@dataclass(frozen=True)
class Document:
    id: str
    filename: str
    kind: DocumentKind
    size_bytes: int
    sha256: str
    status: DocumentStatus
    created_at: datetime
    updated_at: datetime
    page_count: int | None = None
    chunk_count: int | None = None
    char_count: int | None = None
    progress: float = 0.0
    error_code: ErrorCode | None = None
    error_params: Mapping[str, int | str] = field(default_factory=dict)
    notices: tuple[Notice, ...] = ()
    ready_at: datetime | None = None
    # False: uploaded into a chat and only searched there (master spec feedback 1).
    in_library: bool = True


@dataclass(frozen=True)
class Sentence:
    i: int
    text: str
    char_start: int
    char_end: int
    rects: tuple[Rect, ...] = ()


@dataclass(frozen=True)
class Chunk:
    """The searchable unit. `search_text` (context header plus text) is embedded and indexed."""

    chunk_id: str
    document_id: str
    ordinal: int
    page: int | None
    heading: str
    text: str
    search_text: str
    sentences: tuple[Sentence, ...]
    precise_highlight: bool = True
