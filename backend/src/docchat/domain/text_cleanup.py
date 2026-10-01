"""Text cleanup for search and display, with an offset map back to the raw PDF text.

pdfium marks a hyphenated line break as U+FFFE (or U+0002) instead of "-\\r\\n", so "Schutz-art"
arrives as "Schutz\\ufffeart". The marker is removed to make the word searchable. Every cleaned
character remembers the raw index it came from, so sentence spans can still be mapped to the
character positions pdfium uses for line rectangles.

`hidden` raw positions are left out: text the reader never sees on the page (beyond its edge).
A line that only had hidden text disappears with its line break, and spaces next to hidden text
go with it.
"""

import re
import unicodedata
from collections.abc import Collection
from dataclasses import dataclass

_HYPHEN_MARKERS = frozenset({"\ufffe", "\u0002", "\u00ad"})
_LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
}
# Tab, form feed and every Unicode space separator (no-break, thin, hair, en, em, ...).
_SPACES = frozenset(
    {"\t", "\f", "\v", "\u00a0", "\u1680", "\u202f", "\u205f", "\u3000"}
    | {chr(c) for c in range(0x2000, 0x200B)}
)
# Some fonts map the degree sign to WHITE BULLET: "+50\u25e6C" is "+50°C".
_DEGREE = re.compile("\u25e6(?=[CF]\\b)")


def _replacement(char: str) -> str:
    """What one raw character becomes. Newlines are handled by the callers."""
    if char in _HYPHEN_MARKERS:
        return ""
    if char in _SPACES:
        return " "
    if char in _LIGATURES:
        return _LIGATURES[char]
    if unicodedata.category(char) in {"Cc", "Cf"}:
        return ""
    return char


@dataclass(frozen=True)
class CleanText:
    text: str
    raw_index: tuple[int, ...]  # raw position of every character in `text`

    def raw_span(self, start: int, end: int) -> tuple[int, int]:
        """Clean span [start, end) as (raw start, raw count) for pdfium's text APIs."""
        raw_start = self.raw_index[start]
        return raw_start, self.raw_index[end - 1] + 1 - raw_start


def clean_page_text(raw: str, hidden: Collection[int] = frozenset()) -> CleanText:
    chars: list[str] = []
    index: list[int] = []
    line_shown = line_hidden = after_hidden = False

    def emit(piece: str, at: int) -> None:
        for char in piece:
            if char == " " and (not chars or chars[-1] in " \n"):
                continue
            chars.append(char)
            index.append(at)

    i, n = 0, len(raw)
    while i < n:
        char = raw[i]
        if char in "\r\n":
            if chars and chars[-1] == " ":
                chars.pop()
                index.pop()
            if line_shown or not line_hidden:
                chars.append("\n")
                index.append(i)
            line_shown = line_hidden = after_hidden = False
            i += 2 if raw.startswith("\r\n", i) else 1
            continue
        if i in hidden:
            line_hidden = after_hidden = True
            i += 1
            continue
        if char.isspace() and after_hidden:
            i += 1
            continue
        # A base character and its combining marks form one cluster, normalized together.
        end = i + 1
        while end < n and unicodedata.combining(raw[end]):
            end += 1
        cluster = "".join(_replacement(c) for c in raw[i:end])
        emit(unicodedata.normalize("NFC", cluster), i)
        if cluster.strip():
            line_shown, after_hidden = True, False
        i = end
    if line_hidden and not line_shown and chars and chars[-1] == "\n":
        chars.pop()
        index.pop()
    # One character for one: the offset map stays valid.
    return CleanText(_DEGREE.sub("°", "".join(chars)), tuple(index))


_TRANSLATION = str.maketrans(
    {
        **{marker: None for marker in _HYPHEN_MARKERS},
        **dict.fromkeys(_SPACES, " "),
        **_LIGATURES,
        **{chr(c): None for c in range(32) if chr(c) not in "\n\r"},
        **{chr(c): None for c in range(0x7F, 0xA0)},
        **dict.fromkeys(("\u200b", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c"), None),
        **dict.fromkeys(("\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"), None),
        **dict.fromkeys(("\ufeff",), None),
    }
)
_SPACE_RUNS = re.compile(r" {2,}")
_SPACES_AROUND_NEWLINE = re.compile(r" *\n *")


def normalize_text(raw: str) -> str:
    """Same rules as clean_page_text, fast enough for text files with millions of characters."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n").translate(_TRANSLATION)
    text = _DEGREE.sub("°", unicodedata.normalize("NFC", text))
    return _SPACES_AROUND_NEWLINE.sub("\n", _SPACE_RUNS.sub(" ", text)).lstrip(" ")
