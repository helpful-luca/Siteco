"""Headings in PDF page text: a short line in larger type than the page's body text.

pdfium gives lines, not blocks, so "Technische Daten" above a paragraph would otherwise become
the start of the paragraph's first sentence (and be highlighted with it). Cuts before and after
such a line make it a sentence of its own.
"""

from collections.abc import Sequence

# Larger than the body by this factor, and short: a large-type paragraph is not a heading.
_HEADING_FACTOR = 1.15
_MAX_HEADING_CHARS = 120


def _body_size(lines: list[str], sizes: Sequence[float]) -> float:
    """The font size that carries most characters on the page."""
    weight: dict[float, int] = {}
    for line, size in zip(lines, sizes, strict=True):
        weight[round(size, 1)] = weight.get(round(size, 1), 0) + len(line.strip())
    return max(weight, key=lambda size: weight[size])


def heading_line_cuts(text: str, line_sizes: Sequence[float]) -> list[int]:
    """Offsets in `text` where a heading line starts or ends. `line_sizes` has the font size of
    each `\\n`-separated line; if it does not match the lines, nothing is cut."""
    lines = text.split("\n")
    if len(lines) != len(line_sizes) or len(lines) < 2:
        return []
    body = _body_size(lines, line_sizes)
    cuts: set[int] = set()
    start = 0
    for line, size in zip(lines, line_sizes, strict=True):
        end = start + len(line)
        stripped = line.strip()
        if stripped and len(stripped) <= _MAX_HEADING_CHARS and size >= body * _HEADING_FACTOR:
            cuts.update(cut for cut in (start, end + 1) if 0 < cut < len(text))
        start = end + 1
    return sorted(cuts)
