from pathlib import Path

from docchat.adapters.pdf_active_content_detector import PdfActiveContentDetector
from docchat.domain.pdf_active_content import LIMIT_REACHED
from tests.pdf_factory import build_pdf, text_page


def test_a_generated_pdf_is_clean(tmp_path: Path) -> None:
    path = tmp_path / "clean.pdf"
    path.write_bytes(build_pdf([text_page("Die Leuchte hat IP66.")]))
    assert PdfActiveContentDetector().find(path) == frozenset()


def test_finds_an_open_action_with_javascript(tmp_path: Path) -> None:
    path = tmp_path / "active.pdf"
    pdf = build_pdf([text_page("Hallo")])
    # A catalog that runs JavaScript on open, appended as an incremental update.
    path.write_bytes(
        pdf + b"\n9 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"
        b" endobj\n"
    )
    assert PdfActiveContentDetector().find(path) == {"OpenAction", "JavaScript", "JS"}


def test_a_scan_over_its_time_budget_stops_with_a_conservative_result(tmp_path: Path) -> None:
    path = tmp_path / "slow.pdf"
    path.write_bytes(build_pdf([text_page("Hallo")]))
    assert PdfActiveContentDetector(time_budget_s=-1).find(path) == {LIMIT_REACHED}
