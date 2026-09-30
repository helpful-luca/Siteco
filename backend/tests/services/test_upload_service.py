from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.models import Document
from tests.pdf_factory import build_pdf, text_page
from tests.services.conftest import Harness, build_harness

PDF = build_pdf([text_page("Die Leuchte hat IP66.")])


async def _body(data: bytes, piece: int = 400) -> AsyncIterator[bytes]:
    for start in range(0, len(data), piece):
        yield data[start : start + piece]


async def _accept(
    harness: Harness, name: str, data: bytes, declared: int | None = None
) -> Document:
    size = len(data) if declared is None else declared
    return await harness.uploads.accept(name, size, _body(data))


def _temp_files(harness: Harness) -> list[Path]:
    return list((harness.root / "uploads" / "tmp").glob("*"))


async def test_accepts_a_pdf_and_holds_it_for_the_scan(harness: Harness) -> None:
    doc = await _accept(harness, "Datenblatt%20Mira.pdf", PDF)
    assert (doc.status, doc.kind, doc.filename) == ("scanning", "pdf", "Datenblatt Mira.pdf")
    assert doc.size_bytes == len(PDF)
    assert harness.storage.quarantined_path(doc.id, DocumentKind.PDF).read_bytes() == PDF
    assert not harness.storage.exists(doc.id, DocumentKind.PDF)
    assert harness.repository.get(doc.id) == doc
    assert _temp_files(harness) == []
    await harness.scans.process(doc.id)
    assert harness.worker.queue_positions() == {doc.id: 1}


@pytest.mark.parametrize(
    ("name", "data", "declared", "code"),
    [
        ("a.docx", PDF, None, ErrorCode.UNSUPPORTED_TYPE),
        ("%FF.pdf", PDF, None, ErrorCode.VALIDATION_ERROR),
        ("a.pdf", b"", None, ErrorCode.EMPTY_FILE),
        ("a.pdf", b"MZ" + b"\x00" * 2000, None, ErrorCode.FILE_CONTENT_MISMATCH),
        ("a.pdf", b"%PD", None, ErrorCode.FILE_CONTENT_MISMATCH),
        ("a.txt", b"text" + b"\x00" * 5 + b"more", None, ErrorCode.FILE_CONTENT_MISMATCH),
        ("a.pdf", PDF, len(PDF) + 10, ErrorCode.UPLOAD_INCOMPLETE),
        ("a.pdf", PDF, 6 * 1024 * 1024, ErrorCode.UPLOAD_TOO_LARGE),
    ],
)
async def test_rejections_leave_no_files(
    harness: Harness, name: str, data: bytes, declared: int | None, code: ErrorCode
) -> None:
    with pytest.raises(AppError) as info:
        await _accept(harness, name, data, declared)
    assert info.value.code is code
    assert _temp_files(harness) == []
    assert harness.repository.list_visible() == []


async def test_body_larger_than_the_limit_is_cut_off_while_streaming(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, max_bytes=1000)
    with pytest.raises(AppError) as info:
        await _accept(harness, "a.pdf", PDF + b" " * 2000, declared=900)
    assert info.value.code is ErrorCode.UPLOAD_TOO_LARGE
    assert info.value.params == {"max_mb": 0}
    assert _temp_files(harness) == []


async def test_storage_quota_and_free_disk(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, max_storage_bytes=len(PDF) + 10)
    await _accept(harness, "a.pdf", PDF)
    with pytest.raises(AppError) as quota:
        await _accept(harness, "b.pdf", PDF + b"%different")
    assert quota.value.code is ErrorCode.STORAGE_QUOTA
    full = build_harness(tmp_path / "full", min_free_bytes=10**18)
    with pytest.raises(AppError) as disk:
        await _accept(full, "a.pdf", PDF)
    assert disk.value.code is ErrorCode.STORAGE_FULL


async def test_duplicate_points_to_the_existing_document(harness: Harness) -> None:
    first = await _accept(harness, "a.pdf", PDF)
    with pytest.raises(AppError) as info:
        await _accept(harness, "copy.pdf", PDF)
    assert info.value.code is ErrorCode.DUPLICATE_DOCUMENT
    assert info.value.params == {"existing_id": first.id}
    assert _temp_files(harness) == []


async def _failed(harness: Harness) -> Document:
    first = await _accept(harness, "a.pdf", PDF)
    await harness.scans.process(first.id)
    harness.worker.forget(first.id)
    harness.repository.start_parsing(first.id, harness.clock.now())
    harness.repository.mark_failed(first.id, ErrorCode.PROCESSING_TIMEOUT, harness.clock.now())
    harness.storage.delete(first.id, DocumentKind.PDF)
    return first


async def test_duplicate_of_a_failed_document_processes_it_again(harness: Harness) -> None:
    first = await _failed(harness)
    again = await _accept(harness, "a.pdf", PDF)
    assert again.id == first.id
    assert (again.status, again.error_code) == (DocumentStatus.SCANNING, None)
    assert harness.storage.is_quarantined(first.id, DocumentKind.PDF)
    await harness.scans.process(first.id)
    assert harness.storage.exists(first.id, DocumentKind.PDF)
    assert harness.worker.queue_positions() == {first.id: 1}


async def test_utf16_text_with_bom_is_accepted(harness: Harness) -> None:
    doc = await _accept(harness, "notes.txt", "Grüße aus München".encode("utf-16"))
    assert doc.kind is DocumentKind.TXT


async def test_retry_of_a_failed_duplicate_leaves_no_file_if_deleted_meanwhile(
    harness: Harness,
) -> None:
    first = await _failed(harness)
    original_rescan = harness.repository.rescan

    def rescan_then_deleted(document_id: str, now: object) -> bool:
        rescanning = original_rescan(document_id, now)  # type: ignore[arg-type]
        harness.repository.delete(document_id)  # a DELETE request wins the race
        return rescanning

    harness.repository.rescan = rescan_then_deleted  # type: ignore[method-assign]
    with pytest.raises(AppError) as info:
        await _accept(harness, "a.pdf", PDF)
    assert info.value.code is ErrorCode.UPLOAD_INCOMPLETE
    assert not harness.storage.is_quarantined(first.id, DocumentKind.PDF)
    assert not harness.storage.exists(first.id, DocumentKind.PDF)
    assert _temp_files(harness) == []
