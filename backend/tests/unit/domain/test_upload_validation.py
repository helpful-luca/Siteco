import pytest

from docchat.domain.enums import DocumentKind
from docchat.domain.upload_validation import (
    MAGIC_WINDOW,
    content_matches_kind,
    decode_file_name_header,
    kind_for_filename,
    sanitize_filename,
    text_chunk_is_binary,
)


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("a.pdf", DocumentKind.PDF),
        ("A.PDF", DocumentKind.PDF),
        ("notes.txt", DocumentKind.TXT),
        ("readme.md", DocumentKind.MD),
        ("readme.Markdown", DocumentKind.MD),
        ("seite.html", DocumentKind.HTML),
        ("SEITE.HTM", DocumentKind.HTML),
    ],
)
def test_allowed_extensions_map_to_kind(name: str, kind: DocumentKind) -> None:
    assert kind_for_filename(name) is kind


@pytest.mark.parametrize("name", ["a.docx", "b.png", "pdf", "archive.pdf.exe", "noext"])
def test_other_extensions_are_rejected(name: str) -> None:
    assert kind_for_filename(name) is None


def test_pdf_magic_may_follow_a_preamble() -> None:
    assert content_matches_kind(DocumentKind.PDF, b"%PDF-1.7\n...")
    assert content_matches_kind(DocumentKind.PDF, b"\x00" * 500 + b"%PDF-1.4")


def test_pdf_magic_beyond_the_window_is_rejected() -> None:
    assert not content_matches_kind(DocumentKind.PDF, b" " * MAGIC_WINDOW + b"%PDF-1.4")
    assert not content_matches_kind(DocumentKind.PDF, b"MZ\x90\x00 an exe")


def test_text_must_not_contain_nul_bytes() -> None:
    assert content_matches_kind(DocumentKind.TXT, "Grüße aus München".encode())
    assert not content_matches_kind(DocumentKind.MD, b"# title\x00\x01binary")


def test_utf16_with_bom_may_contain_nul_bytes() -> None:
    assert content_matches_kind(DocumentKind.TXT, "Hallo".encode("utf-16"))


def test_streamed_text_chunks_with_nul_bytes_are_binary() -> None:
    assert text_chunk_is_binary(b"plain text", b"more\x00")
    assert not text_chunk_is_binary(b"plain text", b"more text")
    assert not text_chunk_is_binary(b"\xff\xfeH\x00", b"\x00a\x00")


def test_file_name_header_is_percent_decoded() -> None:
    assert decode_file_name_header("Gr%C3%BC%C3%9Fe%20Mira.pdf") == "Grüße Mira.pdf"


@pytest.mark.parametrize("raw", ["%FF%FE.pdf", "", "   "])
def test_undecodable_or_blank_header_is_none(raw: str) -> None:
    assert decode_file_name_header(raw) is None


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("../../etc/passwd.pdf", "passwd.pdf"),
        ("C:\\Users\\anna\\Datenblatt.pdf", "Datenblatt.pdf"),
        ("a\u202etxt.pdf", "atxt.pdf"),  # bidi override removed
        ("line\nbreak\t.pdf", "linebreak.pdf"),
        ("  spaced name .pdf  ", "spaced name .pdf"),
        ("Gro\u0308sse.pdf", "Grösse.pdf"),  # NFD becomes NFC
        ("<img src=x onerror=alert(1)>.pdf", "<img src=x onerror=alert(1)>.pdf"),
    ],
)
def test_sanitize_filename(raw: str, clean: str) -> None:
    assert sanitize_filename(raw) == clean


def test_sanitize_keeps_extension_when_truncating() -> None:
    clean = sanitize_filename("x" * 300 + ".pdf")
    assert len(clean) == 200
    assert clean.endswith("x.pdf")


def test_sanitize_falls_back_to_placeholder() -> None:
    assert sanitize_filename("../\u200b.pdf") == "unbenannt.pdf"
    assert sanitize_filename("///") == "unbenannt"


@pytest.mark.parametrize(
    "head",
    [
        b"<!DOCTYPE html><html><body>x</body></html>",
        b"\xef\xbb\xbf\n  <!doctype HTML>\n<title>x</title>",
        b"<html lang='de'>",
        b"<!-- export -->\n<div class=a>Text</div>",
        b"<p>Nur ein Absatz</p>",
        "<html>".encode("utf-16"),
    ],
)
def test_html_must_look_like_markup(head: bytes) -> None:
    assert content_matches_kind(DocumentKind.HTML, head)


@pytest.mark.parametrize(
    "head",
    [
        b"%PDF-1.7 binary",
        b"Nur Text ohne Tags",
        b"MZ\x90\x00\x03",
        b"<?php echo 1; ?>",
        b"a < b > c",
    ],
)
def test_html_that_is_no_markup_is_rejected(head: bytes) -> None:
    assert not content_matches_kind(DocumentKind.HTML, head)
