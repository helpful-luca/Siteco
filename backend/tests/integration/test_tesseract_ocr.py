"""OCR of scanned pages with the real Tesseract binary (`ocr` marker, skipped without it)."""

from pathlib import Path

import pytest

from docchat.adapters import pdfium_pages
from docchat.adapters.pdfium_ocr_page import OcrOptions, recognize_page
from docchat.adapters.process_runner import IsolatedProcess
from docchat.adapters.tesseract_ocr import TesseractPageOcr
from docchat.cli import ocr_selftest
from tests.pdf_factory import PageSpec, build_pdf
from tests.scan_factory import scanned_page

LINES = ("Die Leuchte Mira hat die Schutzart IP66.", "Sie wiegt nur 7,4 kg und ist robust.")


def _scan(tmp_path: Path, *pages: PageSpec) -> Path:
    path = tmp_path / "scan.pdf"
    path.write_bytes(build_pdf(pages))
    return path


def test_an_empty_page_is_skipped_without_running_tesseract(tmp_path: Path) -> None:
    path = _scan(tmp_path, PageSpec())
    assert recognize_page(path, 0, OcrOptions(binary="/nonexistent/tesseract")) is None


def test_a_missing_binary_means_no_text(tmp_path: Path) -> None:
    path = _scan(tmp_path, scanned_page(*LINES))
    assert recognize_page(path, 0, OcrOptions(binary="/nonexistent/tesseract")) is None


@pytest.mark.ocr
def test_scanned_page_becomes_text_with_sentence_rects(tmp_path: Path) -> None:
    section = recognize_page(_scan(tmp_path, scanned_page(*LINES)), 0, OcrOptions())
    assert section is not None and section.has_text
    assert "Schutzart IP66" in section.text
    assert "7,4 kg" in section.text
    first = section.sentences[0]
    assert "Mira" in section.text[first.start : first.end]
    [(x, y, w, h)] = first.rects
    # text_page starts the first line at x = 72 pt, baseline 740 pt, 14 pt type (letter page).
    assert x == pytest.approx(72 / 612, abs=0.02)
    assert 0.03 < y < 0.08 and 0.005 < h < 0.04 and w > 0.3


@pytest.mark.ocr
async def test_ocr_runs_in_the_isolated_process_with_a_page_timeout(tmp_path: Path) -> None:
    path = _scan(tmp_path, scanned_page(*LINES), scanned_page(*LINES))
    process = IsolatedProcess()
    try:
        ocr = TesseractPageOcr(process, OcrOptions())
        section = await ocr.recognize(path, 2)
        assert section is not None and section.page == 2 and "IP66" in section.text
        hurried = TesseractPageOcr(process, OcrOptions(timeout_s=0.001))
        assert await hurried.recognize(path, 1) is None
    finally:
        await process.close()


def test_self_test_page_is_a_valid_pdf(tmp_path: Path) -> None:
    path = tmp_path / "selftest.pdf"
    path.write_bytes(ocr_selftest._pdf(ocr_selftest._LINES))
    [section] = pdfium_pages.parse_pages(path, 0, 1).sections
    assert "Straßenleuchte Mira" in section.text


@pytest.mark.ocr
def test_self_test_passes_with_tesseract(capsys: pytest.CaptureFixture[str]) -> None:
    assert ocr_selftest.main() == 0
    assert capsys.readouterr().out.strip() == "ocr OK"
