import time
from pathlib import Path

import pytest

from docchat.adapters.text_parser import TextFileParser, decode_text, markdown_headings
from docchat.domain.enums import DocumentKind
from docchat.domain.errors import ErrorCode, IngestionError

GERMAN = "Größe der Straßenleuchte: 5 m, Öffnungswinkel 90°."


@pytest.mark.parametrize(
    "data",
    [
        GERMAN.encode("utf-8"),
        GERMAN.encode("utf-8-sig"),
        GERMAN.encode("utf-16"),  # with BOM, little endian on this platform
        b"\xfe\xff" + GERMAN.encode("utf-16-be"),
        GERMAN.encode("cp1252"),
    ],
)
def test_encoding_fallback_chain(data: bytes) -> None:
    assert decode_text(data) == GERMAN


def test_binary_that_is_not_text_is_rejected() -> None:
    control_bytes = bytes(range(1, 9)) * 50 + b"\xe4"  # not UTF-8, and cp1252 gives no text
    with pytest.raises(IngestionError) as info:
        decode_text(control_bytes)
    assert info.value.code is ErrorCode.TEXT_ENCODING_UNSUPPORTED


def test_bytes_undefined_in_cp1252_are_rejected() -> None:
    with pytest.raises(IngestionError):
        decode_text(b"abc\x81")


def test_markdown_headings_skip_code_fences() -> None:
    text = "Intro\n# Technik\nText\n```\n# kein Titel\n```\nUnterkapitel\n---\nMehr\n## Ende ##\n"
    assert markdown_headings(text) == (
        (6, "Technik"),
        (text.index("Unterkapitel"), "Unterkapitel"),
        (text.index("## Ende"), "Ende"),
    )


def test_parse_markdown_file(tmp_path: Path) -> None:
    path = tmp_path / "a.md"
    path.write_bytes("# Titel\r\nSatz eins. Satz zwei.\r\n".encode("utf-8-sig"))
    content = TextFileParser().parse(path, DocumentKind.MD, max_chars=1000)
    assert content.text == "# Titel\nSatz eins. Satz zwei.\n"
    assert content.headings == ((0, "Titel"),)


def test_txt_files_have_no_headings(tmp_path: Path) -> None:
    path = tmp_path / "a.txt"
    path.write_text("# kein Titel\nText", encoding="utf-8")
    assert TextFileParser().parse(path, DocumentKind.TXT, max_chars=1000).headings == ()


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"  \n\t \n", ErrorCode.DOCUMENT_EMPTY),
        (b"x" * 101, ErrorCode.DOCUMENT_TOO_LONG),
        (b"y" * 500, ErrorCode.DOCUMENT_TOO_LONG),  # rejected by size before reading
    ],
)
def test_empty_and_too_long_files(tmp_path: Path, data: bytes, code: ErrorCode) -> None:
    path = tmp_path / "a.txt"
    path.write_bytes(data)
    with pytest.raises(IngestionError) as info:
        TextFileParser().parse(path, DocumentKind.TXT, max_chars=100)
    assert info.value.code is code


@pytest.mark.parametrize(
    "line",
    [
        "# a" + " " * 200_000 + "b",
        "# a" + "#" * 200_000 + "b",
        "# a" + " #" * 100_000 + "b",
    ],
)
def test_heading_detection_is_linear_on_hostile_lines(line: str) -> None:
    started = time.perf_counter()
    markdown_headings(f"Intro\n{line}\nText")
    assert time.perf_counter() - started < 0.5


def test_closing_hashes_are_stripped_but_not_from_words() -> None:
    text = "# Titel ##\n## C#\n### Nur Rauten ###\n#### x #y"
    assert [title for _, title in markdown_headings(text)] == ["Titel", "C#", "Nur Rauten", "x #y"]


def test_hostile_text_file_parses_fast(tmp_path: Path) -> None:
    path = tmp_path / "evil.md"
    path.write_text("# a" + "#" * 200_000 + "b\n" + "Satz. " * 20_000, encoding="utf-8")
    started = time.perf_counter()
    TextFileParser().parse(path, DocumentKind.MD, max_chars=10_000_000)
    assert time.perf_counter() - started < 1.0
