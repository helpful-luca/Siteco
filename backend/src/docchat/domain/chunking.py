"""Page, then paragraph and sentence: sentences are packed into chunks of about 400 tokens.

Chunks never cross a page or a heading section, so every chunk has exactly one page and one
heading for its context header. Sentences are never split between chunks: they are the unit
that is cited and highlighted.
"""

import re
from collections.abc import Callable, Iterable
from uuid import uuid4

from docchat.domain.highlight_geometry import trusted_rects
from docchat.domain.models import Chunk, Sentence
from docchat.domain.parsing import SentenceSpan, TextSection
from docchat.domain.sentences import split_sentences

TARGET_TOKENS = 400
CHARS_PER_TOKEN = 4  # rough average for German and English prose
_TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN
# At a paragraph break a chunk may end early, once it has at least this share of the target.
_PARAGRAPH_FILL = 0.6
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


def estimate_tokens(text: str) -> int:
    return -(-len(text) // CHARS_PER_TOKEN)


def context_header(document_name: str, page: int | None, heading: str) -> str:
    parts = [f"Dokument: {document_name}"]
    if page is not None:
        parts.append(f"Seite {page}")
    if heading:
        parts.append(f"Abschnitt: {heading}")
    return " / ".join(parts)


def section_from_text(
    text: str,
    *,
    page: int | None = None,
    heading: str = "",
    offset: int = 0,
    cuts: Iterable[int] = (),
) -> TextSection:
    """A section whose sentences come from the splitter (text files, pages without geometry).
    `cuts` are known sentence boundaries, e.g. the end of the heading line."""
    spans = tuple(SentenceSpan(start, end) for start, end in split_sentences(text, cuts))
    return TextSection(text=text, sentences=spans, page=page, heading=heading, offset=offset)


def _groups(section: TextSection) -> list[list[SentenceSpan]]:
    groups: list[list[SentenceSpan]] = []
    current: list[SentenceSpan] = []
    for span in section.sentences:
        if current:
            size_with_span = span.end - current[0].start
            size_now = current[-1].end - current[0].start
            gap = section.text[current[-1].end : span.start]
            paragraph_ends = _PARAGRAPH_BREAK.search(gap) is not None
            if size_with_span > _TARGET_CHARS or (
                paragraph_ends and size_now >= _TARGET_CHARS * _PARAGRAPH_FILL
            ):
                groups.append(current)
                current = []
        current.append(span)
    if current:
        groups.append(current)
    return groups


def chunk_section(
    section: TextSection,
    *,
    document_id: str,
    document_name: str,
    first_ordinal: int,
    new_id: Callable[[], str] = lambda: str(uuid4()),
) -> list[Chunk]:
    header = context_header(document_name, section.page, section.heading)
    chunks = []
    for ordinal, group in enumerate(_groups(section), start=first_ordinal):
        text = section.text[group[0].start : group[-1].end]
        sentences = tuple(
            Sentence(
                i=i,
                text=section.text[span.start : span.end],
                char_start=section.offset + span.start,
                char_end=section.offset + span.end,
                rects=trusted_rects(span.rects),
            )
            for i, span in enumerate(group)
        )
        chunks.append(
            Chunk(
                chunk_id=new_id(),
                document_id=document_id,
                ordinal=ordinal,
                page=section.page,
                heading=section.heading,
                text=text,
                search_text=f"{header}\n{text}",
                sentences=sentences,
                precise_highlight=section.precise_highlight,
            )
        )
    return chunks
