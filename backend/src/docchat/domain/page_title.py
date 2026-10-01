"""The title of a PDF page: its line or lines in clearly larger type than the body text.

pdfium gives no structure, but catalogs and datasheets name the product or the topic of a page
in large type. The title becomes the heading of the page's chunks, so a chunk that only holds
table rows still says which product they belong to, for the search and for Claude.
"""

import re
from collections.abc import Sequence

from docchat.domain.line_breaks import PageLine

TITLE_FACTOR = 1.5  # at least this much larger than the body text
MAX_TITLE_CHARS = 120
_SAME_SIZE = 0.05
_RUN_GAP = 2.0  # lines of one title follow each other within this many times the size
_SPACE = re.compile(r"\s+")


def _body_size(text: str, lines: Sequence[PageLine]) -> float:
    """The font size that carries most characters on the page."""
    weight: dict[float, int] = {}
    for line in lines:
        size = round(line.size, 1)
        weight[size] = weight.get(size, 0) + len(text[line.start : line.end].strip())
    return max(weight, key=lambda size: weight[size])


def _shorten(title: str) -> str:
    if len(title) <= MAX_TITLE_CHARS:
        return title
    cut = title[: MAX_TITLE_CHARS + 1].rsplit(" ", 1)[0]
    return cut.rstrip(" /,")


def page_title(text: str, lines: Sequence[PageLine]) -> str:
    """The page's title, several titles joined by " / ", or "" when no line stands out."""
    candidates = [
        line
        for line in lines
        if any(c.isalpha() for c in text[line.start : line.end])
        and line.end - line.start <= MAX_TITLE_CHARS
    ]
    if not candidates:
        return ""
    top = max(line.size for line in candidates)
    if top < _body_size(text, lines) * TITLE_FACTOR:
        return ""
    groups: list[list[str]] = []
    previous: PageLine | None = None
    for line in candidates:
        if abs(line.size - top) > top * _SAME_SIZE:
            continue
        follows = previous is not None and 0 < line.top - previous.end_top <= top * _RUN_GAP
        part = _SPACE.sub(" ", text[line.start : line.end]).strip()
        if follows and groups:
            groups[-1].append(part)
        else:
            groups.append([part])
        previous = line
    return _shorten(" / ".join(" ".join(group) for group in groups))
