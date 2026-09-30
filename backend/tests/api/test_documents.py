"""Documents API end to end: real SQLite, LanceDB, files and pdfium; fake embedder."""

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from docchat.core.config import Settings
from tests.pdf_factory import PageSpec, build_pdf, text_page
from tests.support import make_app

PDF = build_pdf([text_page("Die Leuchte Mira hat IP66.", "Sie liefert 5000 Lumen.")])


def upload(client: TestClient, name: str, data: bytes, **headers: str) -> Response:
    base = {"X-File-Name": quote(name), "Content-Type": "application/octet-stream"}
    return client.post("/api/documents", content=data, headers=base | headers)


def wait_until_settled(client: TestClient, doc_id: str, timeout: float = 30) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        document: dict[str, Any] = client.get(f"/api/documents/{doc_id}").json()["document"]
        if document["status"] in {"ready", "failed"}:
            return document
        time.sleep(0.05)
    raise AssertionError("document did not settle")


def error(r: Response) -> dict[str, Any]:
    body: dict[str, Any] = r.json()["error"]
    return body


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(make_app(settings)) as c:
        yield c


def test_pdf_upload_is_accepted_and_ingested(client: TestClient) -> None:
    r = upload(client, "Datenblatt Größe.pdf", PDF)
    assert r.status_code == 202
    doc = r.json()["document"]
    assert doc["filename"] == "Datenblatt Größe.pdf"
    assert (doc["kind"], doc["size_bytes"], doc["error_code"]) == ("pdf", len(PDF), None)
    assert doc["status"] in {"queued", "parsing", "embedding", "ready"}
    ready = wait_until_settled(client, doc["id"])
    assert ready["status"] == "ready", ready
    assert (ready["page_count"], ready["chunk_count"], ready["progress"]) == (1, 1, 1.0)
    assert ready["queue_position"] is None
    assert ready["ready_at"] is not None


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("notes.txt", "Grüße aus München. Zweiter Satz.".encode("cp1252")),
        ("readme.md", b"# Technik\nIP66.\n\n## Montage\nAm Mast."),
    ],
)
def test_text_uploads_are_ingested(client: TestClient, name: str, data: bytes) -> None:
    doc = upload(client, name, data).json()["document"]
    ready = wait_until_settled(client, doc["id"])
    assert ready["status"] == "ready"
    assert ready["page_count"] is None


@pytest.mark.parametrize(
    ("name", "data", "code"),
    [
        ("locked.pdf", build_pdf([text_page("Geheim.")], user_password="pw"), "PDF_ENCRYPTED"),
        ("broken.pdf", PDF[:200], "PDF_CORRUPT"),
        ("scan.pdf", build_pdf([PageSpec(image_only=True)]), "PDF_NO_TEXT"),
        ("binary.txt", bytes(range(1, 9)) * 50 + b"\xe4", "TEXT_ENCODING_UNSUPPORTED"),
        ("blank.md", b"   \n\n  ", "DOCUMENT_EMPTY"),
    ],
)
def test_ingestion_failures_end_as_failed_with_a_code(
    client: TestClient, name: str, data: bytes, code: str
) -> None:
    r = upload(client, name, data)
    assert r.status_code == 202
    failed = wait_until_settled(client, r.json()["document"]["id"])
    assert (failed["status"], failed["error_code"]) == ("failed", code)


def test_partly_scanned_pdf_is_ready_with_a_notice(client: TestClient) -> None:
    data = build_pdf([text_page("Seite mit genug lesbarem Text."), PageSpec(image_only=True)])
    ready = wait_until_settled(client, upload(client, "half.pdf", data).json()["document"]["id"])
    assert ready["status"] == "ready"
    assert ready["notices"] == [{"code": "PAGES_WITHOUT_TEXT", "params": {"count": 1}}]


# Upload errors -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("headers", "status", "code"),
    [
        ({"X-File-Name": "a.docx"}, 415, "UNSUPPORTED_TYPE"),
        ({"X-File-Name": "%FF%FE.pdf"}, 422, "VALIDATION_ERROR"),
        ({"Content-Type": "multipart/form-data"}, 422, "VALIDATION_ERROR"),
        ({"Content-Type": "text/plain"}, 422, "VALIDATION_ERROR"),
    ],
)
def test_upload_header_errors(
    client: TestClient, headers: dict[str, str], status: int, code: str
) -> None:
    r = upload(client, "a.pdf", PDF, **headers)
    assert (r.status_code, error(r)["code"]) == (status, code)


def test_missing_file_name_header(client: TestClient) -> None:
    r = client.post(
        "/api/documents", content=PDF, headers={"Content-Type": "application/octet-stream"}
    )
    assert (r.status_code, error(r)["code"]) == (422, "VALIDATION_ERROR")


def test_missing_content_length(client: TestClient) -> None:
    def chunked() -> Iterator[bytes]:
        yield PDF

    r = client.post(
        "/api/documents",
        content=chunked(),
        headers={"X-File-Name": "a.pdf", "Content-Type": "application/octet-stream"},
    )
    assert (r.status_code, error(r)["code"]) == (422, "VALIDATION_ERROR")


@pytest.mark.parametrize(
    ("name", "data", "status", "code"),
    [
        ("a.pdf", b"", 422, "EMPTY_FILE"),
        ("a.pdf", b"MZ\x90\x00" + b"x" * 2000, 415, "FILE_CONTENT_MISMATCH"),
        ("a.md", b"# ok\x00\x00binary", 415, "FILE_CONTENT_MISMATCH"),
    ],
)
def test_upload_content_errors(
    client: TestClient, name: str, data: bytes, status: int, code: str
) -> None:
    r = upload(client, name, data)
    assert (r.status_code, error(r)["code"]) == (status, code)


def test_body_shorter_than_content_length_is_incomplete(client: TestClient) -> None:
    r = upload(client, "a.pdf", PDF, **{"Content-Length": str(len(PDF) + 100)})
    assert (r.status_code, error(r)["code"]) == (400, "UPLOAD_INCOMPLETE")
    assert error(r)["retryable"] is True


def test_too_large_uses_the_configured_limit(settings: Settings) -> None:
    small = settings.model_copy(update={"max_upload_mb": 1})
    with TestClient(make_app(small)) as c:
        r = upload(c, "big.pdf", PDF + b" " * (1024 * 1024))
    assert (r.status_code, error(r)["code"]) == (413, "UPLOAD_TOO_LARGE")
    assert error(r)["params"] == {"max_mb": 1}


def test_storage_quota(settings: Settings) -> None:
    tight = settings.model_copy(update={"max_storage_mb": 1})
    half = b" " * (600 * 1024)
    with TestClient(make_app(tight)) as c:
        assert upload(c, "a.pdf", PDF + half).status_code == 202
        r = upload(c, "b.pdf", PDF + half + b"x")
    assert (r.status_code, error(r)["code"]) == (409, "STORAGE_QUOTA")
    assert error(r)["params"] == {"max_mb": 1}


def test_disk_full(settings: Settings) -> None:
    greedy = settings.model_copy(update={"min_free_disk_mb": 10**9})
    with TestClient(make_app(greedy)) as c:
        r = upload(c, "a.pdf", PDF)
    assert (r.status_code, error(r)["code"]) == (507, "STORAGE_FULL")


def test_duplicate_upload_returns_the_existing_id(client: TestClient) -> None:
    first = upload(client, "a.pdf", PDF).json()["document"]["id"]
    r = upload(client, "renamed.pdf", PDF)
    assert (r.status_code, error(r)["code"]) == (409, "DUPLICATE_DOCUMENT")
    assert error(r)["params"] == {"existing_id": first}


def test_rejected_uploads_leave_no_temp_files(client: TestClient, settings: Settings) -> None:
    upload(client, "a.pdf", b"MZ" + b"x" * 5000)
    upload(client, "a.pdf", PDF, **{"Content-Length": str(len(PDF) + 1)})
    assert list((settings.uploads_dir / "tmp").glob("*")) == []


# Library -------------------------------------------------------------------------------


def test_list_get_and_delete(client: TestClient, settings: Settings) -> None:
    older = upload(client, "old.pdf", PDF).json()["document"]["id"]
    newer = upload(client, "new.md", b"# Titel\nText.").json()["document"]["id"]
    listed = client.get("/api/documents").json()["documents"]
    assert [d["id"] for d in listed] == [newer, older]
    wait_until_settled(client, older)
    assert client.delete(f"/api/documents/{older}").status_code == 204
    assert client.get(f"/api/documents/{older}").status_code == 404
    assert client.delete(f"/api/documents/{older}").status_code == 404
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [newer]
    assert not (settings.uploads_dir / f"{older}.pdf").exists()


def test_unknown_and_malformed_ids(client: TestClient) -> None:
    r = client.get(f"/api/documents/{uuid4()}")
    assert (r.status_code, error(r)["code"]) == (404, "NOT_FOUND")
    assert client.get("/api/documents/not-a-uuid").status_code == 422
    assert client.get("/api/documents/..%2F..%2Fetc/file").status_code in {404, 422}


def test_file_download_has_safe_headers(client: TestClient) -> None:
    doc_id = upload(client, "Größe & <b>.pdf", PDF).json()["document"]["id"]
    r = client.get(f"/api/documents/{doc_id}/file")
    assert r.status_code == 200
    assert r.content == PDF
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == (
        "inline; filename*=UTF-8''Gr%C3%B6%C3%9Fe%20%26%20%3Cb%3E.pdf"
    )
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == "sandbox; default-src 'none'"
    assert r.headers["cross-origin-resource-policy"] == "same-origin"
    assert r.headers["cache-control"] == "private, max-age=3600"
    assert r.headers["accept-ranges"] == "bytes"


def test_markdown_is_served_as_plain_text(client: TestClient) -> None:
    doc_id = upload(client, "x.md", b"<script>alert(1)</script>").json()["document"]["id"]
    r = client.get(f"/api/documents/{doc_id}/file")
    assert r.headers["content-type"] == "text/plain; charset=utf-8"


def test_range_requests(client: TestClient) -> None:
    doc_id = upload(client, "a.pdf", PDF).json()["document"]["id"]
    r = client.get(f"/api/documents/{doc_id}/file", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206
    assert r.content == PDF[:10]
    assert r.headers["content-range"] == f"bytes 0-9/{len(PDF)}"
    suffix = client.get(f"/api/documents/{doc_id}/file", headers={"Range": "bytes=-5"})
    assert (suffix.status_code, suffix.content) == (206, PDF[-5:])
    beyond = client.get(f"/api/documents/{doc_id}/file", headers={"Range": f"bytes={len(PDF)}-"})
    assert (beyond.status_code, error(beyond)["code"]) == (416, "RANGE_NOT_SATISFIABLE")
    for bad in ("items=0-1", "bytes=a-b", "bytes=5-1", "bytes=-"):
        r = client.get(f"/api/documents/{doc_id}/file", headers={"Range": bad})
        assert (r.status_code, error(r)["code"]) == (422, "VALIDATION_ERROR"), bad


def test_missing_original_file_is_gone(client: TestClient, settings: Settings) -> None:
    doc_id = upload(client, "a.pdf", PDF).json()["document"]["id"]
    wait_until_settled(client, doc_id)
    (settings.uploads_dir / f"{doc_id}.pdf").unlink()
    r = client.get(f"/api/documents/{doc_id}/file")
    assert (r.status_code, error(r)["code"]) == (410, "DOCUMENT_FILE_MISSING")


def _chunk_ids(client: TestClient, doc_id: str) -> list[str]:
    table = client.app.state.container.vectors._require()  # type: ignore[attr-defined]
    rows = table.search().where(f"document_id = '{doc_id}'").select(["chunk_id"]).to_list()
    return [row["chunk_id"] for row in rows]


def test_chunk_endpoint_returns_sentences_with_rects(client: TestClient) -> None:
    doc_id = upload(client, "a.pdf", PDF).json()["document"]["id"]
    wait_until_settled(client, doc_id)
    [chunk_id] = _chunk_ids(client, doc_id)
    r = client.get(f"/api/documents/{doc_id}/chunks/{chunk_id}")
    assert r.status_code == 200
    chunk = r.json()
    assert (chunk["chunk_id"], chunk["page"], chunk["precise_highlight"]) == (chunk_id, 1, True)
    assert [s["text"] for s in chunk["sentences"]] == [
        "Die Leuchte Mira hat IP66.",
        "Sie liefert 5000 Lumen.",
    ]
    for sentence in chunk["sentences"]:
        [rect] = sentence["rects"]
        assert all(0 <= v <= 1 for v in rect)
    missing = client.get(f"/api/documents/{doc_id}/chunks/{uuid4()}")
    assert (missing.status_code, error(missing)["code"]) == (404, "NOT_FOUND")
    other_doc = client.get(f"/api/documents/{uuid4()}/chunks/{chunk_id}")
    assert other_doc.status_code == 404


def test_uploaded_files_use_uuid_names_on_disk(client: TestClient, settings: Settings) -> None:
    doc_id = upload(client, "../../evil.pdf", PDF).json()["document"]["id"]
    assert [p.name for p in settings.uploads_dir.glob("*.pdf")] == [f"{doc_id}.pdf"]
    assert client.get(f"/api/documents/{doc_id}").json()["document"]["filename"] == "evil.pdf"


def test_ready_documents_survive_a_restart(settings: Settings) -> None:
    with TestClient(make_app(settings)) as c:
        doc_id = upload(c, "a.pdf", PDF).json()["document"]["id"]
        wait_until_settled(c, doc_id)
    with TestClient(make_app(settings)) as c:
        doc = c.get(f"/api/documents/{doc_id}").json()["document"]
        assert doc["status"] == "ready"
        assert len(_chunk_ids(c, doc_id)) == 1


def test_path_is_never_built_from_the_file_name(settings: Settings, tmp_path: Path) -> None:
    with TestClient(make_app(settings)) as c:
        upload(c, "/etc/passwd.pdf", PDF)
    assert not (tmp_path / "etc").exists()


def test_file_deleted_between_lookup_and_stat_is_missing(client: TestClient) -> None:
    from docchat.domain.enums import DocumentKind
    from docchat.services.document_service import StoredFile

    doc_id = upload(client, "a.pdf", PDF).json()["document"]["id"]
    documents = client.app.state.container.documents  # type: ignore[attr-defined]
    ghost = StoredFile(Path("/nonexistent/ghost.pdf"), DocumentKind.PDF, "a.pdf")
    documents.file = lambda document_id: ghost
    r = client.get(f"/api/documents/{doc_id}/file")
    assert (r.status_code, error(r)["code"]) == (410, "DOCUMENT_FILE_MISSING")
