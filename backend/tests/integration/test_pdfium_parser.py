"""pdfium adapter on PDFs generated at test time (see tests/pdf_factory.py)."""

from pathlib import Path

import pytest

from docchat.adapters import pdfium_pages
from docchat.adapters.pdfium_pages import normalize_rect
from docchat.adapters.pdfium_parser import PdfiumParser
from docchat.adapters.process_runner import ProcessCrashed, ProcessTimeout
from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.parsing import PageBatchFailed
from tests.pdf_factory import PageSpec, TextLine, build_pdf, text_page


def _write(tmp_path: Path, data: bytes, name: str = "doc.pdf") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def _only_section(path: Path, index: int = 0):  # type: ignore[no-untyped-def]
    batch = pdfium_pages.parse_pages(path, index, 1)
    assert batch.unreadable_pages == ()
    [section] = batch.sections
    return section


def test_normalize_rect_against_crop_box_and_rotation() -> None:
    page = (0.0, 0.0, 100.0, 200.0)
    box = (10.0, 150.0, 30.0, 170.0)  # left, bottom, right, top
    assert normalize_rect(box, page, 0) == (0.1, 0.15, 0.2, 0.1)
    assert normalize_rect(box, page, 90) == (0.75, 0.1, 0.1, 0.2)
    assert normalize_rect(box, page, 180) == (0.7, 0.75, 0.2, 0.1)
    assert normalize_rect(box, page, 270) == (0.15, 0.7, 0.1, 0.2)
    assert normalize_rect(box, (10.0, 100.0, 60.0, 200.0), 0) == (0.0, 0.3, 0.4, 0.2)


def test_page_text_sentences_and_line_rects(tmp_path: Path) -> None:
    pdf = _write(tmp_path, build_pdf([text_page("Die Leuchte ist hell. Sie hat IP66.")]))
    section = _only_section(pdf)
    assert section.page == 1
    assert section.precise_highlight is True
    assert section.text == "Die Leuchte ist hell. Sie hat IP66."
    first, second = section.sentences
    assert section.text[first.start : first.end] == "Die Leuchte ist hell."
    assert len(first.rects) == 1
    x, y, w, h = first.rects[0]
    assert 0.1 < x < 0.15 and 0.03 < y < 0.08 and 0 < h < 0.03
    assert second.rects[0][0] > x + w  # second sentence starts right of the first


def test_hyphenated_line_break_is_joined_and_spans_two_lines(tmp_path: Path) -> None:
    pdf = _write(tmp_path, build_pdf([text_page("Sie hat die Schutz-", "art IP66 und mehr.")]))
    section = _only_section(pdf)
    assert "Schutzart IP66" in section.text
    [sentence] = section.sentences
    assert len(sentence.rects) == 2


def test_rotated_page_rects_follow_the_displayed_orientation(tmp_path: Path) -> None:
    rotated = PageSpec(lines=[TextLine("Gedrehte Seite mit Text.", x=72, y=720)], rotate=90)
    section = _only_section(_write(tmp_path, build_pdf([rotated])))
    x, y, w, h = section.sentences[0].rects[0]
    # Unrotated the text sits top left and runs to the right; turned clockwise it sits at the
    # right edge and runs downwards.
    assert x > 0.85 and 0.1 < y < 0.15 and h > w


def test_rects_are_relative_to_the_crop_box(tmp_path: Path) -> None:
    cropped = PageSpec(
        lines=[TextLine("Beschnittene Seite.", x=100, y=500)], crop_box=(50, 50, 562, 742)
    )
    section = _only_section(_write(tmp_path, build_pdf([cropped])))
    x, y, _, _ = section.sentences[0].rects[0]
    assert x == pytest.approx((100 - 50) / 512, abs=0.01)
    assert y == pytest.approx((742 - 509) / 692, abs=0.02)


def test_image_only_page_has_no_text_layer(tmp_path: Path) -> None:
    pdf = _write(tmp_path, build_pdf([PageSpec(image_only=True), text_page("Genug Text hier.")]))
    batch = pdfium_pages.parse_pages(pdf, 0, 10)
    assert [s.page for s in batch.sections] == [1, 2]
    assert not batch.sections[0].has_text
    assert batch.sections[0].sentences == ()


def test_batches_cover_a_page_range(tmp_path: Path) -> None:
    pages = [text_page(f"Seite Nummer {n} mit Inhalt.") for n in range(1, 6)]
    pdf = _write(tmp_path, build_pdf(pages))
    assert pdfium_pages.count_pages(pdf) == 5
    assert [s.page for s in pdfium_pages.parse_pages(pdf, 1, 2).sections] == [2, 3]
    assert [s.page for s in pdfium_pages.parse_pages(pdf, 4, 50).sections] == [5]


def test_open_password_is_rejected_but_permission_only_protection_is_fine(tmp_path: Path) -> None:
    locked = _write(tmp_path, build_pdf([text_page("Geheim.")], user_password="pw"), "locked.pdf")
    with pytest.raises(IngestionError) as info:
        pdfium_pages.count_pages(locked)
    assert info.value.code is ErrorCode.PDF_ENCRYPTED
    restricted = build_pdf([text_page("Nur Rechte eingeschraenkt.")], owner_password="owner")
    section = _only_section(_write(tmp_path, restricted, "restricted.pdf"))
    assert section.text == "Nur Rechte eingeschraenkt."


@pytest.mark.parametrize(
    "data",
    [build_pdf([text_page("abgeschnitten")])[:120], b"%PDF-1.7\nnothing else", b"MZ\x90\x00"],
)
def test_corrupt_files_are_reported(tmp_path: Path, data: bytes) -> None:
    with pytest.raises(IngestionError) as info:
        pdfium_pages.count_pages(_write(tmp_path, data))
    assert info.value.code is ErrorCode.PDF_CORRUPT


async def test_parser_runs_pdfium_in_its_own_process(tmp_path: Path) -> None:
    pdf = _write(tmp_path, build_pdf([text_page("Eins."), text_page("Zwei.")]))
    parser = PdfiumParser(timeout_s=30)
    try:
        assert await parser.count_pages(pdf) == 2
        batch = await parser.parse_pages(pdf, 0, 2)
        assert [s.text for s in batch.sections] == ["Eins.", "Zwei."]
        locked = _write(tmp_path, build_pdf([text_page("x")], user_password="pw"), "l.pdf")
        with pytest.raises(IngestionError):
            await parser.count_pages(locked)
    finally:
        await parser.close()


class _FailingProcess:
    def __init__(self, error: Exception) -> None:
        self.error = error

    async def run(self, *args: object, **kwargs: object) -> None:
        raise self.error

    async def close(self) -> None:
        return None


@pytest.mark.parametrize(
    ("error", "timed_out"), [(ProcessTimeout(), True), (ProcessCrashed(), False)]
)
async def test_batch_timeouts_and_crashes_become_batch_failures(
    tmp_path: Path, error: Exception, timed_out: bool
) -> None:
    parser = PdfiumParser(timeout_s=1)
    parser._process = _FailingProcess(error)  # type: ignore[assignment]
    with pytest.raises(PageBatchFailed) as info:
        await parser.parse_pages(tmp_path / "x.pdf", 0, 50)
    assert info.value.timed_out is timed_out
    with pytest.raises(IngestionError) as counted:
        await parser.count_pages(tmp_path / "x.pdf")
    expected = ErrorCode.PROCESSING_TIMEOUT if timed_out else ErrorCode.PDF_CORRUPT
    assert counted.value.code is expected


def test_a_heading_line_in_larger_type_is_its_own_sentence(tmp_path: Path) -> None:
    page = PageSpec(
        lines=[
            TextLine("Technische Daten", x=72, y=740, size=20),
            TextLine("Die Mira L ist nach IP66 geschützt, nicht nur der", x=72, y=700, size=11),
            TextLine("Optikraum. Die Schlagfestigkeit liegt bei IK09.", x=72, y=684, size=11),
        ]
    )
    section = _only_section(_write(tmp_path, build_pdf([page])))
    texts = [section.text[s.start : s.end] for s in section.sentences]
    assert texts[0] == "Technische Daten"
    assert texts[1] == "Die Mira L ist nach IP66 geschützt, nicht nur der\nOptikraum."
    assert len(section.sentences[1].rects) == 2


def test_text_outside_the_crop_box_is_not_part_of_the_page(tmp_path: Path) -> None:
    # Catalogs exported as spreads carry the facing page's text beyond the page edge. It is not
    # visible, belongs to another page and must neither be indexed nor cited here.
    page = PageSpec(
        lines=[
            TextLine("Sichtbare Zeile auf der Seite.", x=72, y=740),
            TextLine("Rechte Seite der Doppelseite.", x=700, y=740),
            TextLine("Nur rechts daneben.", x=700, y=720),
            TextLine("Unten sichtbar.", x=72, y=700),
            TextLine("Unter dem Seitenrand.", x=72, y=-40),
        ]
    )
    section = _only_section(_write(tmp_path, build_pdf([page])))
    assert section.text == "Sichtbare Zeile auf der Seite.\nUnten sichtbar."
    assert section.precise_highlight is True
    assert [section.text[s.start : s.end] for s in section.sentences] == [
        "Sichtbare Zeile auf der Seite.",
        "Unten sichtbar.",
    ]
    assert all(0 <= x <= 0.5 for s in section.sentences for x, _, _, _ in s.rects)
