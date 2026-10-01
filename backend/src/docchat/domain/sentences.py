"""Sentence spans: the unit that is cited, highlighted and packed into chunks.

Deliberately simple rules for German and English technical documents. A missed boundary only makes
a highlight a bit longer; a wrong boundary inside "ca. 12.50" would split a citation, so the rules
err on the side of keeping text together.
"""

import re
from collections.abc import Iterable

MAX_SENTENCE_CHARS = 600

_ABBREVIATIONS = frozenset(
    {
        "abb", "abs", "bzw", "ca", "dr", "etc", "evtl", "fa", "fig", "fr", "ggf", "hr", "inkl",
        "max", "min", "mio", "mrd", "nr", "no", "s", "st", "str", "tab", "tel", "usw", "vgl",
        "vs", "z.b", "u.a", "d.h", "e.g", "i.e", "zzgl", "approx", "incl", "resp",
    }
)  # fmt: skip
# Terminal punctuation, optional closing quotes or brackets, whitespace, then a capital or digit.
_SENTENCE_END = re.compile(r"[.!?…][\"'“”»«)\]]*(?=\s+[\"'„«»(\[]?[A-ZÀ-Þ0-9])")
_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n\s*")
_LIST_ITEM = re.compile(r"\n(?=[ \t]*(?:[-*•·▪]\s|\d{1,2}[.)]\s|[a-z]\)\s))")
_TOKEN_WINDOW = 16  # longer than any abbreviation; keeps the check constant per boundary


def _is_abbreviation(text: str, dot: int) -> bool:
    if text[dot] != ".":
        return False
    # Spaced dots ("51RE . . . A") are a placeholder, not the end of a sentence.
    if dot == 0 or text[dot - 1].isspace() or text[dot - 1] == ".":
        return True
    # A token cut off by the window is longer than every abbreviation, so the cut is harmless.
    before = text[max(0, dot - _TOKEN_WINDOW) : dot].split()
    if not before:
        return False
    token = before[-1].lower().lstrip("(\"'")
    # Compounds end in the abbreviation: "Bestell-Nr.", "Art.-Nr.".
    last = token.rsplit("-", 1)[-1]
    return (
        token in _ABBREVIATIONS
        or last in _ABBREVIATIONS
        or token.isdigit()
        or (len(token) == 1 and token.isalpha())
    )


def _boundaries(text: str) -> list[int]:
    cuts = {m.end() for m in _SENTENCE_END.finditer(text) if not _is_abbreviation(text, m.start())}
    cuts.update(m.start() for m in _PARAGRAPH_BREAK.finditer(text))
    cuts.update(m.start() for m in _LIST_ITEM.finditer(text))
    return sorted(cuts)


def _trim(text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _cap(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """Splits an overlong span at the last line break or space before the limit."""
    spans = []
    while end - start > MAX_SENTENCE_CHARS:
        limit = start + MAX_SENTENCE_CHARS
        cut = text.rfind("\n", start + 1, limit + 1)
        if cut <= start:
            cut = text.rfind(" ", start + 1, limit + 1)
        if cut <= start:
            cut = limit
        piece = _trim(text, start, cut)
        if piece:
            spans.append(piece)
        start = cut
        trimmed = _trim(text, start, end)
        if trimmed is None:
            return spans
        start, end = trimmed
    spans.append((start, end))
    return spans


def split_sentences(text: str, extra_cuts: Iterable[int] = ()) -> list[tuple[int, int]]:
    """Returns [start, end) spans without surrounding whitespace, in text order. `extra_cuts` are
    boundaries the caller knows from the structure (the end of a heading line)."""
    spans: list[tuple[int, int]] = []
    start = 0
    forced = {cut for cut in extra_cuts if 0 < cut < len(text)}
    for cut in [*sorted(forced.union(_boundaries(text))), len(text)]:
        trimmed = _trim(text, start, cut)
        if trimmed:
            spans.extend(_cap(text, *trimmed))
        start = cut
    return spans
