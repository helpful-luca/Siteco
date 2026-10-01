"""A scanned PDF through the whole pipeline with real Tesseract (`ocr` marker)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from docchat.core.config import Settings
from tests.api.test_documents import _chunk_ids, upload, wait_until_settled
from tests.pdf_factory import build_pdf, scanned_page, text_page
from tests.support import make_app

pytestmark = pytest.mark.ocr


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(make_app(settings.model_copy(update={"ocr": "on"}))) as c:
        yield c


def test_scanned_page_is_searchable_and_highlightable(client: TestClient) -> None:
    data = build_pdf(
        [
            text_page("Erste Seite mit einer echten Textebene und genug Text."),
            scanned_page("Die Leuchte Mira hat die Schutzart IP66.", "Sie wiegt nur 7,4 kg."),
        ]
    )
    doc_id = upload(client, "scan.pdf", data).json()["document"]["id"]
    ready = wait_until_settled(client, doc_id, timeout=90)
    assert ready["status"] == "ready", ready
    assert ready["notices"] == [{"code": "PAGES_OCR", "params": {"count": 1}}]
    ids = _chunk_ids(client, doc_id)
    chunks = [client.get(f"/api/documents/{doc_id}/chunks/{c}").json() for c in ids]
    [scanned] = [c for c in chunks if c["page"] == 2]
    assert "Schutzart IP66" in scanned["text"]
    assert scanned["precise_highlight"] is True
    assert all(sentence["rects"] for sentence in scanned["sentences"])
