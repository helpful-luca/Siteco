"""Which line breaks of a PDF page end a unit (a sentence, a table row, a list item).

pdfium gives lines, not paragraphs or table cells. Splitting only at sentence punctuation glues
a whole spec table or a price list into one "sentence" of hundreds of characters, so a citation
of one row would mark the whole table. The layout tells them apart: a line break is only a soft
wrap inside a paragraph when the next line continues right below in the same column and type,
both lines are one run of text (a table row has gaps between its cells), and the next line's
first word would not have fitted at the end of the line with room to spare (otherwise the break
was intended). Layout programs balance the lines of a paragraph, so a line may end a word or two
short of the margin: the spare room must be a clear share of the column. A heading in larger
type is cut off by the size change, a heading over two lines stays one unit.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

# Runs closer than this (times the font size) are one segment: words, a bullet and its text.
_SEGMENT_GAP = 1.5
# The next line's top at most this far below (times the size): normal leading, no gap.
_MAX_LEADING = 2.0
_SIZE_TOLERANCE = 0.15
_ALIGN = 0.6  # left edges within this share of the size count as the same column
_SPACE = 0.3  # width of a space, times the size
# A break is intended when the next word fits with this share of the column width to spare.
_SPARE = 0.15


@dataclass(frozen=True)
class PageLine:
    """One non-empty line of a page's text: [start, end) offsets, the x ranges of its text runs
    from left to right, its top (growing downwards), its font size and the width of its first
    word, all in points."""

    start: int
    end: int
    spans: tuple[tuple[float, float], ...]
    top: float
    size: float
    first_word: float

    @property
    def left(self) -> float:
        return self.spans[0][0]

    @property
    def right(self) -> float:
        return self.spans[-1][1]

    @property
    def one_segment(self) -> bool:
        gap = self.size * _SEGMENT_GAP
        return all(after[0] - before[1] <= gap for before, after in pairwise(self.spans))


def _continues(line: PageLine, nxt: PageLine) -> bool:
    """`nxt` sits right below `line` in the same column and type, both are one run of text."""
    if not (line.one_segment and nxt.one_segment and line.size > 0):
        return False
    if abs(nxt.size - line.size) > line.size * _SIZE_TOLERANCE:
        return False
    if not 0 < nxt.top - line.top <= line.size * _MAX_LEADING:
        return False
    # The same left edge, or a hanging indent under the text after a bullet.
    return any(abs(nxt.left - x0) <= line.size * _ALIGN for x0, _ in line.spans)


def _matches(text: str, lines: Sequence[PageLine]) -> bool:
    if len(lines) != sum(1 for part in text.split("\n") if part.strip()):
        return False
    return all(0 <= ln.start < ln.end <= len(text) and ln.spans for ln in lines)


def line_break_cuts(text: str, lines: Sequence[PageLine]) -> list[int]:
    """Offsets in `text` (the start of a line) where the previous line's unit ends."""
    if not _matches(text, lines):
        return []
    cuts: list[int] = []
    # Paragraph runs: lines that continue each other. The widest line gives the right margin.
    runs: list[list[PageLine]] = []
    for line in lines:
        if runs and _continues(runs[-1][-1], line):
            runs[-1].append(line)
        else:
            runs.append([line])
            if len(runs) > 1:
                cuts.append(line.start)
    for run in runs:
        margin = max(line.right for line in run)
        spare = (margin - min(line.left for line in run)) * _SPARE
        for line, nxt in pairwise(run):
            room = margin - line.right - line.size * _SPACE
            if nxt.first_word + spare <= room:
                cuts.append(nxt.start)
    return sorted(c for c in cuts if 0 < c < len(text))
