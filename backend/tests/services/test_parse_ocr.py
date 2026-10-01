"""Pages without a text layer go to OCR page by page, with their own progress and notices."""

from pathlib import Path

from docchat.domain.enums import DocumentStatus
from docchat.domain.errors import NoticeCode
from docchat.domain.models import Notice
from tests.fakes import FakePageOcr
from tests.services.conftest import build_harness

TEXT = "Die Leuchte ist hell. Sie hat IP66 und 5000 Lumen."
SCANNED = "Gescannte Seite mit der Schutzart IP65 und viel Text."


async def test_recognized_pages_are_indexed_in_page_order(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, ocr=FakePageOcr({2: SCANNED}))
    doc = harness.add_document(pages=[TEXT, "", TEXT])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None and ready.status is DocumentStatus.READY
    assert ready.notices == (Notice(NoticeCode.PAGES_OCR, {"count": 1}),)
    chunks = sorted((c for c, _ in harness.vectors.rows.values()), key=lambda c: c.ordinal)
    assert [(c.ordinal, c.page) for c in chunks] == [(0, 1), (1, 2), (2, 3)]
    assert chunks[1].text == SCANNED
    assert harness.ocr.calls == [2]


async def test_pages_ocr_cannot_read_stay_without_text(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, ocr=FakePageOcr({1: SCANNED}))
    doc = harness.add_document(pages=["", "", TEXT])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None and ready.status is DocumentStatus.READY
    assert ready.notices == (
        Notice(NoticeCode.PAGES_OCR, {"count": 1}),
        Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": 1}),
    )


async def test_ocr_runs_as_its_own_stage_with_progress(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, ocr=FakePageOcr({2: SCANNED, 3: SCANNED}), batch_pages=4)
    doc = harness.add_document(pages=[TEXT, "", "", TEXT])
    seen: list[tuple[DocumentStatus, float, tuple[Notice, ...]]] = []

    def record(page_number: int) -> None:
        current = harness.reload(doc)
        assert current is not None
        seen.append((current.status, current.progress, current.notices))

    harness.ocr.during = record
    await harness.worker.process(doc.id)
    assert seen == [
        (DocumentStatus.PARSING, 0.0, (Notice(NoticeCode.OCR_RUNNING, {"page": 2, "pages": 4}),)),
        (DocumentStatus.PARSING, 0.5, (Notice(NoticeCode.OCR_RUNNING, {"page": 3, "pages": 4}),)),
    ]
    ready = harness.reload(doc)
    assert ready is not None
    assert ready.notices == (Notice(NoticeCode.PAGES_OCR, {"count": 2}),)


async def test_without_ocr_nothing_is_recognized_and_no_stage_is_shown(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, ocr=FakePageOcr({2: SCANNED}, available=False))
    doc = harness.add_document(pages=[TEXT, ""])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None
    assert ready.notices == (Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": 1}),)
    assert harness.ocr.calls == []


async def test_a_missing_engine_is_said_plainly_once(tmp_path: Path) -> None:
    ocr = FakePageOcr({}, available=False)
    ocr.engine_missing = True
    harness = build_harness(tmp_path, ocr=ocr)
    doc = harness.add_document(pages=[TEXT, "", ""])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None
    assert ready.notices == (
        Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": 2}),
        Notice(NoticeCode.OCR_ENGINE_MISSING),
    )


async def test_a_scan_only_pdf_becomes_searchable(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, ocr=FakePageOcr({1: SCANNED}))
    doc = harness.add_document(pages=[""])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None and ready.status is DocumentStatus.READY
    assert harness.vectors.count(doc.id) == 1


async def test_pages_without_a_title_keep_the_title_of_the_page_before(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, batch_pages=2)
    doc = harness.add_document(pages=[TEXT, "", TEXT, TEXT])
    path = harness.storage.path_for(doc.id, doc.kind)
    harness.pdf.titles[path.name] = {1: "Highbay 11 midi", 4: "Highbay 11 maxi"}
    await harness.worker.process(doc.id)
    chunks = sorted((c for c, _ in harness.vectors.rows.values()), key=lambda c: c.ordinal)
    assert [(c.page, c.heading) for c in chunks] == [
        (1, "Highbay 11 midi"),
        (3, "Highbay 11 midi"),  # a continuation page after a photo, in the next batch
        (4, "Highbay 11 maxi"),
    ]
    assert "Highbay" not in chunks[1].search_text  # the title reaches Claude, not the index
