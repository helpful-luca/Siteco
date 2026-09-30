"""Static check for active PDF content (master spec 6.9), streaming over the raw bytes.

Looks for the PDF names that make a viewer run or open something: JavaScript, launch actions,
embedded files, open and additional actions, rich media and XFA forms. The file is still
processed (only text is extracted, the viewer executes nothing); the library shows a notice.

Rules that keep it honest:
- Names are whole tokens and `#xx` escapes are decoded (`/J#61vaScript` is `/JavaScript`).
- Bytes inside ordinary streams (images, page content) are skipped: random binary data would
  otherwise "contain" short names like `/JS` or `/AA`.
- Object streams (`/Type /ObjStm`) hide dictionaries in compressed data, so they are inflated
  and scanned too, capped to defuse decompression bombs.

Only linear regular expressions; memory stays bounded by the read size plus a small tail.
"""

import re
import zlib
from collections.abc import Callable

ACTIVE_NAMES = frozenset(
    {"JavaScript", "JS", "Launch", "EmbeddedFile", "OpenAction", "AA", "RichMedia", "XFA"}
)

_DELIMITERS = frozenset(b"\x00\t\n\x0c\r ()<>[]{}/%")
_NAME = re.compile(rb"/([^\x00\t\n\x0c\r ()<>\[\]{}/%]*)")
_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")
_STREAM_START = re.compile(rb"(?<![A-Za-z/])stream(?:\r\n|\n|\r)")
_STREAM_END = b"endstream"
_MAX_NAME = 256  # longer names are never one of ours
_DEFAULT_MAX_INFLATED = 64 * 1024 * 1024


def _decode(raw: bytes) -> str:
    return _ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), raw).decode("latin-1")


class _NameTokens:
    """Finds name tokens in data that arrives in pieces; a name cut in half waits for the rest."""

    def __init__(self, on_name: Callable[[str], None]) -> None:
        self._on_name = on_name
        self._carry = b""

    def feed(self, data: bytes, *, final: bool = False) -> None:
        buffer = self._carry + data
        cut = len(buffer) if final else self._last_boundary(buffer)
        for match in _NAME.finditer(buffer, 0, cut):
            self._on_name(_decode(match.group(1)))
        self._carry = buffer[cut:]

    @staticmethod
    def _last_boundary(buffer: bytes) -> int:
        """Index of the last delimiter: every name before it is complete."""
        for i in range(len(buffer) - 1, max(-1, len(buffer) - 1 - _MAX_NAME), -1):
            if buffer[i] in _DELIMITERS:
                return i
        return len(buffer)


class ActiveContentScan:
    """Feed the file in pieces, then call finish() for the active names that were found."""

    def __init__(self, max_inflated: int = _DEFAULT_MAX_INFLATED) -> None:
        self._found: set[str] = set()
        self._buffer = b""
        self._in_stream = False
        self._object_stream_ahead = False
        self._outside = _NameTokens(self._on_outside_name)
        self._inside = _NameTokens(self._on_name)
        self._inflater: zlib._Decompress | None = None
        self._inflate_budget = max_inflated

    def feed(self, data: bytes) -> None:
        self._buffer += data
        self._process(final=False)

    def finish(self) -> frozenset[str]:
        self._process(final=True)
        self._outside.feed(b"", final=True)
        self._end_stream()
        return frozenset(self._found)

    def _on_name(self, name: str) -> None:
        if name in ACTIVE_NAMES:
            self._found.add(name)

    def _on_outside_name(self, name: str) -> None:
        if name == "ObjStm":
            self._object_stream_ahead = True
        self._on_name(name)

    def _process(self, *, final: bool) -> None:
        while self._buffer:
            if self._in_stream:
                if not self._consume_stream(final=final):
                    return
            elif not self._consume_outside(final=final):
                return

    def _consume_outside(self, *, final: bool) -> bool:
        """Scans names up to the next `stream` keyword. False: needs more data."""
        buffer = self._buffer
        match = _STREAM_START.search(buffer)
        if match and not final and match.end() == len(buffer) and buffer.endswith(b"\r"):
            match = None  # "\r" may be the first half of "\r\n"
        if match is None:
            cut = len(buffer) if final else max(0, len(buffer) - len(b"stream\r"))
            self._outside.feed(buffer[:cut])
            self._buffer = buffer[cut:]
            return False
        self._outside.feed(buffer[: match.start()], final=True)
        self._start_stream()
        self._buffer = buffer[match.end() :]
        return True

    def _consume_stream(self, *, final: bool) -> bool:
        """Skips (or inflates) stream data up to `endstream`. False: needs more data."""
        buffer = self._buffer
        end = buffer.find(_STREAM_END)
        if end == -1:
            cut = len(buffer) if final else max(0, len(buffer) - len(_STREAM_END) + 1)
            self._inflate(buffer[:cut])
            self._buffer = buffer[cut:]
            return False
        self._inflate(buffer[:end])
        self._end_stream()
        self._buffer = buffer[end + len(_STREAM_END) :]
        return True

    def _start_stream(self) -> None:
        self._in_stream = True
        if self._object_stream_ahead and self._inflate_budget > 0:
            self._inflater = zlib.decompressobj()
        self._object_stream_ahead = False

    def _end_stream(self) -> None:
        self._in_stream = False
        self._inflater = None
        self._inside.feed(b"", final=True)

    def _inflate(self, data: bytes) -> None:
        if self._inflater is None or not data:
            return
        try:
            out = self._inflater.decompress(data, self._inflate_budget)
        except zlib.error:
            self._inflater = None  # not Flate, or damaged: nothing more to learn here
            return
        self._inflate_budget -= len(out)
        self._inside.feed(out)
        if self._inflate_budget <= 0 or self._inflater.eof:
            self._inflater = None
