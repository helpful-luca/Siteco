from collections.abc import Callable

import pytest

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from tests.services.conftest import Harness

TEXT = "Die Leuchte ist hell. Sie hat IP66."


def _code(call: Callable[[], object]) -> ErrorCode:
    with pytest.raises(AppError) as info:
        call()
    return info.value.code


async def test_list_hides_deleting_and_shows_queue_positions(harness: Harness) -> None:
    first = harness.add_document(pages=[TEXT])
    second = harness.add_document(pages=[TEXT])
    harness.worker.enqueue(first)
    harness.repository.mark_deleting(second.id, harness.clock.now())
    views = harness.documents.list()
    assert [(v.document.id, v.queue_position) for v in views] == [(first.id, 1)]


async def test_file_and_chunk_lookups(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT])
    await harness.worker.process(doc.id)
    stored = harness.documents.file(doc.id)
    assert stored.path == harness.storage.path_for(doc.id, DocumentKind.PDF)
    assert stored.filename == doc.filename
    [chunk_id] = list(harness.vectors.rows)
    assert harness.documents.chunk(doc.id, chunk_id).text == TEXT
    assert _code(lambda: harness.documents.chunk(doc.id, "nope")) is ErrorCode.NOT_FOUND
    assert _code(lambda: harness.documents.get("nope")) is ErrorCode.NOT_FOUND


async def test_file_errors(harness: Harness) -> None:
    missing = harness.add_document(pages=[TEXT])
    harness.storage.delete(missing.id, DocumentKind.PDF)
    assert _code(lambda: harness.documents.file(missing.id)) is ErrorCode.DOCUMENT_FILE_MISSING
    going = harness.add_document(pages=[TEXT])
    harness.repository.mark_deleting(going.id, harness.clock.now())
    assert _code(lambda: harness.documents.file(going.id)) is ErrorCode.DOCUMENT_NOT_READY
    assert _code(lambda: harness.documents.chunk(going.id, "x")) is ErrorCode.NOT_FOUND


async def test_delete_is_idempotent_from_the_outside(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT])
    harness.worker.enqueue(doc)
    await harness.documents.delete(doc.id)
    assert harness.worker.queue_positions() == {}
    with pytest.raises(AppError) as info:
        await harness.documents.delete(doc.id)
    assert info.value.code is ErrorCode.NOT_FOUND


async def test_failed_delete_keeps_the_row_hidden_for_the_next_start(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT])

    def broken(document_id: str) -> None:
        raise OSError("disk gone")

    harness.vectors.delete_document = broken  # type: ignore[method-assign]
    with pytest.raises(AppError) as info:
        await harness.documents.delete(doc.id)
    assert info.value.code is ErrorCode.DELETE_FAILED
    assert harness.reload(doc).status is DocumentStatus.DELETING  # type: ignore[union-attr]
    assert harness.documents.list() == []
