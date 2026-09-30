"""What parsers hand to the chunker. Produced by adapters, consumed by services."""

from dataclasses import dataclass

from docchat.domain.models import Rect

# Fewer visible characters than this means the page has no usable text layer (probably scanned).
MIN_TEXT_CHARS_PER_PAGE = 20


@dataclass(frozen=True)
class SentenceSpan:
    """[start, end) inside TextSection.text, plus one rectangle per covered line (PDF only)."""

    start: int
    end: int
    rects: tuple[Rect, ...] = ()


@dataclass(frozen=True)
class TextSection:
    """One PDF page, or one block of a text file under the same heading."""

    text: str
    sentences: tuple[SentenceSpan, ...]
    page: int | None = None
    heading: str = ""
    offset: int = 0  # where `text` starts in the whole document (text files); 0 for PDF pages
    precise_highlight: bool = True

    @property
    def has_text(self) -> bool:
        return sum(not c.isspace() for c in self.text) >= MIN_TEXT_CHARS_PER_PAGE


@dataclass(frozen=True)
class PageBatch:
    """Result of parsing a range of PDF pages in the parser process."""

    sections: tuple[TextSection, ...]
    unreadable_pages: tuple[int, ...] = ()


@dataclass(frozen=True)
class TextContent:
    """A decoded text file: NFC, LF line endings, and the start offset and title of each heading."""

    text: str
    headings: tuple[tuple[int, str], ...] = ()


class PageBatchFailed(Exception):
    """The parser process timed out or died on a batch of pages. Only these pages are lost."""

    def __init__(self, timed_out: bool) -> None:
        super().__init__(timed_out)
        self.timed_out = timed_out
