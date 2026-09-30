"""TXT and Markdown: encoding detection, normalization and Markdown headings as chunk context."""

import re
from pathlib import Path

from docchat.domain.enums import DocumentKind
from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.parsing import TextContent
from docchat.domain.text_cleanup import normalize_text

_BOMS = (
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe", "utf-16"),
    (b"\xfe\xff", "utf-16"),
)
# cp1252 decodes almost any byte sequence, so it is only trusted for text that looks like text.
_MIN_PRINTABLE_SHARE = 0.95
_MAX_BYTES_PER_CHAR = 4

_ATX = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$")
_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_FENCE = re.compile(r"^ {0,3}(```|~~~)")


def decode_text(data: bytes) -> str:
    for bom, encoding in _BOMS:
        if data.startswith(bom):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError as exc:
                raise IngestionError(ErrorCode.TEXT_ENCODING_UNSUPPORTED) from exc
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        text = data.decode("cp1252")
    except UnicodeDecodeError as exc:
        raise IngestionError(ErrorCode.TEXT_ENCODING_UNSUPPORTED) from exc
    printable = sum(c.isprintable() or c in "\n\r\t" for c in text)
    if printable < len(text) * _MIN_PRINTABLE_SHARE:
        raise IngestionError(ErrorCode.TEXT_ENCODING_UNSUPPORTED)
    return text


def markdown_headings(text: str) -> tuple[tuple[int, str], ...]:
    """(offset of the heading line, heading title) for ATX and setext headings outside code."""
    headings: list[tuple[int, str]] = []
    in_fence = False
    offset = 0
    previous: tuple[int, str] | None = None  # last non-empty paragraph line
    for line in text.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            previous = None
        elif not in_fence:
            atx = _ATX.match(line)
            setext = _SETEXT.match(line)
            if atx and atx.group(2):
                headings.append((offset, atx.group(2).strip()))
                previous = None
            elif setext and previous is not None:
                headings.append(previous)
                previous = None
            else:
                previous = (offset, line.strip()) if line.strip() else None
        offset += len(line) + 1
    return tuple(headings)


class TextFileParser:
    def parse(self, path: Path, kind: DocumentKind, max_chars: int) -> TextContent:
        if path.stat().st_size > max_chars * _MAX_BYTES_PER_CHAR + len(b"\xef\xbb\xbf"):
            raise IngestionError(ErrorCode.DOCUMENT_TOO_LONG)
        text = normalize_text(decode_text(path.read_bytes()))
        if len(text) > max_chars:
            raise IngestionError(ErrorCode.DOCUMENT_TOO_LONG)
        if not text.strip():
            raise IngestionError(ErrorCode.DOCUMENT_EMPTY)
        headings = markdown_headings(text) if kind is DocumentKind.MD else ()
        return TextContent(text=text, headings=headings)
