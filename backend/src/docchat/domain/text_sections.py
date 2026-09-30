"""Cuts a decoded text file into sections per heading, and long sections into bounded blocks.

Blocks keep memory flat for huge text files: sentences are split one block at a time.
"""

from collections.abc import Iterator

from docchat.domain.chunking import section_from_text
from docchat.domain.parsing import TextContent, TextSection

MAX_BLOCK_CHARS = 100_000
_SETEXT_UNDERLINE = frozenset("=-")


def _heading_end(text: str, start: int, end: int) -> int:
    """End of the heading line at `start`, a setext underline below it included."""
    line_end = text.find("\n", start, end)
    if line_end < 0:
        return end
    next_end = text.find("\n", line_end + 1, end)
    underline = text[line_end + 1 : next_end if next_end >= 0 else end].strip()
    if underline and set(underline) <= _SETEXT_UNDERLINE:
        return next_end if next_end >= 0 else end
    return line_end


def _cut(text: str, start: int, end: int, max_chars: int) -> Iterator[tuple[int, int]]:
    """Yields [start, end) blocks of at most max_chars, preferring paragraph then line breaks."""
    while end - start > max_chars:
        limit = start + max_chars
        cut = text.rfind("\n\n", start + 1, limit)
        if cut <= start:
            cut = text.rfind("\n", start + 1, limit)
        if cut <= start:
            cut = text.rfind(" ", start + 1, limit)
        if cut <= start:
            cut = limit
        yield start, cut
        start = cut
        while start < end and text[start].isspace():
            start += 1
    if start < end:
        yield start, end


def text_sections(
    content: TextContent, *, max_block_chars: int = MAX_BLOCK_CHARS
) -> Iterator[TextSection]:
    text = content.text
    bounds = [(0, "")] + [h for h in content.headings if h[0] > 0]
    if content.headings and content.headings[0][0] == 0:
        bounds[0] = content.headings[0]
    for index, (start, heading) in enumerate(bounds):
        end = bounds[index + 1][0] if index + 1 < len(bounds) else len(text)
        # The heading line is a sentence of its own, not the start of the first paragraph's.
        heading_end = _heading_end(text, start, end) if heading else start
        for block_start, block_end in _cut(text, start, end, max_block_chars):
            block = text[block_start:block_end].rstrip()
            if block.strip():
                cuts = (heading_end - block_start,) if block_start <= heading_end else ()
                yield section_from_text(block, heading=heading, offset=block_start, cuts=cuts)
