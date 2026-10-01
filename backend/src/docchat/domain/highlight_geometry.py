"""Which sentence rectangles can be trusted. Pure functions, no I/O.

pdfium returns a sentence's text in the order of the content stream. On plain prose that is
reading order and the line rectangles mark the sentence. In catalogs (several columns, tables,
text over images) the stream order jumps around: a "sentence" then collects lines from far
apart and the mark would cover the wrong places. A wrong mark is worse than none, so such
sentences get no rectangles and the viewer marks the passage on the page instead.
"""

from collections.abc import Sequence
from itertools import pairwise

from docchat.domain.models import Rect

MAX_LINES = 12  # a sentence of more lines is a table cell run or a column collage
MAX_JUMPS = 1  # lines that start clearly above the previous one: one column break is normal
_JUMP_UP = 0.6  # of a line height
_PAGE_SHARE = 0.5  # a rectangle wider and taller than this share of the page is not a line


def _jumps(rects: Sequence[Rect]) -> int:
    count = 0
    for before, after in pairwise(rects):
        if after[1] < before[1] - max(before[3], after[3]) * _JUMP_UP:
            count += 1
    return count


def rects_are_reliable(rects: Sequence[Rect]) -> bool:
    if len(rects) > MAX_LINES or _jumps(rects) > MAX_JUMPS:
        return False
    return not any(w > _PAGE_SHARE and h > _PAGE_SHARE for _, _, w, h in rects)


def trusted_rects(rects: Sequence[Rect]) -> tuple[Rect, ...]:
    """The rectangles, or none at all when they do not describe the sentence."""
    return tuple(rects) if rects_are_reliable(rects) else ()
