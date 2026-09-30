from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode, NoticeCode
from docchat.domain.models import Document, Notice

T0 = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


def _doc(doc_id: str = "d1", sha: str = "a" * 64, **changes: object) -> Document:
    base = Document(
        id=doc_id,
        filename="Datenblatt.pdf",
        kind=DocumentKind.PDF,
        size_bytes=1000,
        sha256=sha,
        status=DocumentStatus.QUEUED,
        created_at=T0,
        updated_at=T0,
    )
    return replace(base, **changes)  # type: ignore[arg-type]


@pytest.fixture
def repo(tmp_path: Path) -> SqliteDocumentRepository:
    db = Database(tmp_path / "app.db")
    db.migrate()
    return SqliteDocumentRepository(db)


def test_insert_and_get_round_trip(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc())
    assert repo.get("d1") == _doc()
    assert repo.get("missing") is None


def test_duplicate_sha_raises_with_existing_id(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc())
    with pytest.raises(AppError) as info:
        repo.insert(_doc("d2"))
    assert info.value.code is ErrorCode.DUPLICATE_DOCUMENT
    assert info.value.params == {"existing_id": "d1"}


def test_list_visible_is_newest_first_and_hides_deleting(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc("old", "1" * 64))
    repo.insert(_doc("new", "2" * 64, created_at=T0 + timedelta(seconds=1)))
    repo.insert(_doc("gone", "3" * 64, created_at=T0 + timedelta(seconds=2)))
    repo.mark_deleting("gone", T0)
    assert [d.id for d in repo.list_visible()] == ["new", "old"]
    assert repo.total_size_bytes() == 3000
    assert repo.all_ids() == {"old", "new", "gone"}


def test_happy_path_transitions(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc())
    notice = Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": 2})
    assert repo.start_parsing("d1", T0)
    assert repo.set_progress("d1", DocumentStatus.PARSING, 0.5, T0, page_count=12)
    assert repo.get("d1").page_count == 12  # type: ignore[union-attr]
    assert repo.start_embedding(
        "d1", T0, page_count=12, chunk_count=40, char_count=9000, notices=[notice]
    )
    assert repo.set_progress("d1", DocumentStatus.EMBEDDING, 1.7, T0)
    later = T0 + timedelta(minutes=1)
    assert repo.mark_ready("d1", later)
    doc = repo.get("d1")
    assert doc is not None
    assert (doc.status, doc.progress, doc.chunk_count, doc.char_count) == ("ready", 1, 40, 9000)
    assert doc.notices == (notice,)
    assert doc.ready_at == later


def test_transitions_are_compare_and_set(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc())
    assert not repo.start_embedding("d1", T0, page_count=1, chunk_count=1, char_count=1, notices=[])
    assert not repo.mark_ready("d1", T0)
    assert not repo.set_progress("d1", DocumentStatus.PARSING, 0.1, T0)
    repo.mark_deleting("d1", T0)
    assert not repo.start_parsing("d1", T0)
    assert not repo.mark_failed("d1", ErrorCode.PDF_CORRUPT, T0)
    assert not repo.requeue("d1", T0)
    assert repo.get("d1").status is DocumentStatus.DELETING  # type: ignore[union-attr]


def test_failed_documents_can_be_requeued_with_a_clean_slate(
    repo: SqliteDocumentRepository,
) -> None:
    repo.insert(_doc())
    repo.start_parsing("d1", T0)
    assert repo.mark_failed("d1", ErrorCode.PROCESSING_TIMEOUT, T0)
    assert repo.get("d1").error_code is ErrorCode.PROCESSING_TIMEOUT  # type: ignore[union-attr]
    assert repo.requeue("d1", T0)
    doc = repo.get("d1")
    assert doc is not None
    assert (doc.status, doc.error_code, doc.progress) == (DocumentStatus.QUEUED, None, 0)


def test_mark_deleting_returns_none_for_unknown_ids(repo: SqliteDocumentRepository) -> None:
    assert repo.mark_deleting("nope", T0) is None
    repo.insert(_doc())
    assert repo.mark_deleting("d1", T0).status is DocumentStatus.DELETING  # type: ignore[union-attr]
    repo.delete("d1")
    assert repo.get("d1") is None


def test_list_by_status(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc("a", "1" * 64))
    repo.insert(_doc("b", "2" * 64))
    repo.start_parsing("b", T0)
    assert [d.id for d in repo.list_by_status(DocumentStatus.PARSING)] == ["b"]
    assert {d.id for d in repo.list_by_status(DocumentStatus.QUEUED, DocumentStatus.PARSING)} == {
        "a",
        "b",
    }
