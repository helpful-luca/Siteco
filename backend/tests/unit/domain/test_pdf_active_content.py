import time
import zlib

import pytest

from docchat.domain.pdf_active_content import LIMIT_REACHED, ActiveContentScan


def scan(data: bytes, piece: int | None = None, **kwargs: int) -> frozenset[str]:
    scanner = ActiveContentScan(**kwargs)
    step = piece or max(1, len(data))
    for start in range(0, len(data), step):
        scanner.feed(data[start : start + step])
    return scanner.finish()


PLAIN = b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>"


def test_a_plain_pdf_has_no_active_content() -> None:
    assert scan(PLAIN) == frozenset()


@pytest.mark.parametrize("name", ["JavaScript", "JS", "Launch", "EmbeddedFile", "RichMedia", "XFA"])
def test_each_active_name_is_found(name: str) -> None:
    data = b"1 0 obj << /Type /Catalog /" + name.encode() + b" 5 0 R >> endobj"
    assert scan(data) == {name}


def test_an_open_action_that_only_jumps_to_a_page_is_not_active() -> None:
    # InDesign and Acrobat set "open at page 1, fit": the Siteco catalog has it.
    data = (
        b"1 0 obj << /Type /Catalog /OpenAction 5 0 R /PageLayout /TwoPageRight >> endobj\n"
        b"5 0 obj << /D [7 0 R /Fit] /S /GoTo >> endobj\n"
        b"9 0 obj << /Type /Annot /Subtype /Link /A << /S /URI /URI (https://siteco.com) >> >>"
    )
    assert scan(data) == frozenset()


@pytest.mark.parametrize("action", ["GoToR", "GoToE", "SubmitForm", "ImportData", "Rendition"])
@pytest.mark.parametrize("trigger", ["OpenAction", "AA"])
def test_open_and_additional_actions_count_when_they_run_or_open_something(
    trigger: str, action: str
) -> None:
    data = b"1 0 obj << /" + trigger.encode() + b" << /S /" + action.encode() + b" >> >> endobj"
    assert scan(data) == {trigger, action}


def test_names_only_match_as_whole_tokens() -> None:
    assert scan(b"<< /JSON 1 /AAB 2 /Launcher 3 /XFAB 4 >>") == frozenset()


def test_hex_escaped_names_are_decoded() -> None:
    assert scan(b"<< /J#61vaScript (app.alert(1)) /#4F#70enAction 3 0 R >>") == {
        "JavaScript",
        "OpenAction",
    }


def test_names_split_across_reads_are_found() -> None:
    data = PLAIN + b"\n4 0 obj << /S /JavaScript /JS (x) >> endobj\n" + PLAIN
    assert scan(data, piece=1) == {"JavaScript", "JS"}
    assert scan(data, piece=7) == {"JavaScript", "JS"}


def test_bytes_inside_ordinary_streams_are_ignored() -> None:
    noise = b"random /JS /AA bytes that happen to look like names"
    data = b"5 0 obj << /Length 60 >>\nstream\n" + noise + b"\nendstream\nendobj\n" + PLAIN
    assert scan(data) == frozenset()
    assert scan(data, piece=5) == frozenset()


def test_names_after_a_stream_are_found_again() -> None:
    data = b"<< /Length 3 >>\nstream\nabc\nendstream\n<< /Launch 1 0 R >>"
    assert scan(data, piece=4) == {"Launch"}


def test_compressed_object_streams_are_inflated() -> None:
    hidden = zlib.compress(b"10 0 20 << /Type /Action /S /Launch /F (calc.exe) >>")
    data = (
        b"7 0 obj << /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode /Length "
        + str(len(hidden)).encode()
        + b" >>\nstream\r\n"
        + hidden
        + b"\nendstream\nendobj\n"
    )
    assert scan(data) == {"Launch"}
    assert scan(data, piece=3) == {"Launch"}


def test_inflating_stops_at_the_cap() -> None:
    bomb = zlib.compress(b" " * 200_000 + b"/JavaScript")
    data = b"<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n" + bomb + b"\nendstream"
    assert scan(data, max_inflated=100_000) == frozenset()
    assert scan(data, max_inflated=1_000_000) == {"JavaScript"}


def test_broken_compressed_data_is_skipped() -> None:
    data = b"<< /Type /ObjStm >>\nstream\nnot zlib at all\nendstream\n<< /XFA 1 >>"
    assert scan(data) == {"XFA"}


def test_the_result_does_not_depend_on_the_read_size() -> None:
    hidden = zlib.compress(b"<< /S /JavaScript /JS (x) >>")
    data = (
        PLAIN
        + b"\n<< /Length 9 >>\nstream\r\n/AA /Launch\nendstream\n"
        + b"<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n"
        + hidden
        + b"\nendstream\n<< /Names << /EmbeddedFiles 3 0 R >> /XFA 4 0 R >>"
    )
    expected = {"JavaScript", "JS", "XFA"}
    assert scan(data) == expected
    for piece in range(1, 40):
        assert scan(data, piece=piece) == expected, piece


def test_many_tiny_streams_are_scanned_in_linear_time() -> None:
    data = b"<<>>stream\nendstream\n" * 300_000 + b"<< /XFA 1 >>"  # about 6 MB
    started = time.perf_counter()
    assert scan(data, piece=1024 * 1024, max_streams=10**9) == {"XFA"}
    assert time.perf_counter() - started < 5


def test_too_many_streams_stop_the_scan_with_a_conservative_result() -> None:
    data = b"<<>>stream\nendstream\n" * 50 + b"<< /XFA 1 >>"
    assert scan(data, max_streams=10) == {LIMIT_REACHED}


def test_the_word_stream_in_a_string_does_not_start_a_stream() -> None:
    data = b"<< /Title (a stream\n) /Launch 1 0 R >>"
    assert scan(data) == {"Launch"}
