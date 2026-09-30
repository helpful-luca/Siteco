"""Cheap upload checks that run inside the request: extension, magic bytes, display name."""

import unicodedata
from urllib.parse import unquote

from docchat.domain.enums import DocumentKind

MAGIC_WINDOW = 1024  # the PDF spec tolerates a preamble before the header
MAX_FILENAME_CHARS = 200
FALLBACK_STEM = "unbenannt"

_EXTENSIONS = {
    ".pdf": DocumentKind.PDF,
    ".txt": DocumentKind.TXT,
    ".md": DocumentKind.MD,
    ".markdown": DocumentKind.MD,
}
_MAX_EXTENSION_CHARS = 10
_UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")


def _split_extension(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    if dot < 0 or len(name) - dot > _MAX_EXTENSION_CHARS:
        return name, ""
    return name[:dot], name[dot:]


def kind_for_filename(name: str) -> DocumentKind | None:
    return _EXTENSIONS.get(_split_extension(name)[1].lower())


def content_matches_kind(kind: DocumentKind, head: bytes) -> bool:
    """`head` is the start of the file, at least MAGIC_WINDOW bytes unless the file is shorter."""
    if kind is DocumentKind.PDF:
        return b"%PDF-" in head[: MAGIC_WINDOW + len(b"%PDF-") - 1]
    return head.startswith(_UTF16_BOMS) or b"\x00" not in head


def chunk_is_textual(chunk: bytes) -> bool:
    """Text files are checked as they stream: any NUL byte means binary content."""
    return b"\x00" not in chunk


def allows_nul_bytes(head: bytes) -> bool:
    return head.startswith(_UTF16_BOMS)


def decode_file_name_header(raw: str) -> str | None:
    """`X-File-Name` is percent-encoded UTF-8. Returns None if it is blank or undecodable."""
    try:
        name = unquote(raw, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        return None
    return name if name.strip() else None


def _is_visible(char: str) -> bool:
    # Cc: control characters, Cf: format characters (bidi overrides, zero width), Co/Cs: private.
    return unicodedata.category(char) not in {"Cc", "Cf", "Co", "Cs"}


def sanitize_filename(raw: str) -> str:
    """Display name only (never used as a path): basename, NFC, no invisible characters."""
    base = raw.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in unicodedata.normalize("NFC", base) if _is_visible(c)).strip()
    stem, extension = _split_extension(name)
    if not stem.strip(" ."):
        stem = FALLBACK_STEM
    stem = stem[: MAX_FILENAME_CHARS - len(extension)]
    return stem + extension
