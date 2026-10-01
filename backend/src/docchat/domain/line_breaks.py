"""Which line breaks of a PDF page end a unit (a sentence, a table row, a list item).

pdfium gives lines, not paragraphs or cells, and splitting only at punctuation would turn a
whole table into one sentence. A break counts as a soft wrap only when the layout says so: the
next line continues right below in the same column and type, and its first word would not have
fitted on the line before.
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
    in text order, its top (growing downwards), its font size and the width of its first
    word, all in points. pdfium joins a hyphenated word into one line, so a line may cover two
    printed lines: `left` is where it starts, `right` and `last_top` where it ends."""

    start: int
    end: int
    spans: tuple[tuple[float, float], ...]
    top: float
    size: float
    first_word: float
    last_top: float | None = None

    @property
    def end_top(self) -> float:
        return self.top if self.last_top is None else self.last_top

    @property
    def left(self) -> float:
        return self.spans[0][0]

    @property
    def right(self) -> float:
        return self.spans[-1][1]

    @property
    def segments(self) -> list[tuple[float, float]]:
        """The runs merged where they are close: a table row has several, a sentence one."""
        merged: list[tuple[float, float]] = []
        for x0, x1 in self.spans:
            if merged and x0 - merged[-1][1] <= self.size * _SEGMENT_GAP:
                merged[-1] = (merged[-1][0], max(merged[-1][1], x1))
            else:
                merged.append((x0, x1))
        return merged


def _continues(line: PageLine, nxt: PageLine) -> bool:
    """`nxt` sits right below `line` in the same column and type and is one run of text: under
    the line's start, under the text after a bullet, or under the value of a "label  value"
    line (a cell that wraps). A line of more runs is a table row and ends there."""
    segments = line.segments
    if line.size <= 0 or len(segments) > 2 or len(nxt.segments) != 1:
        return False
    if abs(nxt.size - line.size) > line.size * _SIZE_TOLERANCE:
        return False
    if not 0 < nxt.top - line.end_top <= line.size * _MAX_LEADING:
        return False
    starts = [segments[-1][0]] if len(segments) == 2 else [x0 for x0, _ in line.spans]
    return any(abs(nxt.left - x0) <= line.size * _ALIGN for x0 in starts)


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
