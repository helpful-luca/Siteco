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


def test_scan_transitions(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc(status=DocumentStatus.SCANNING))
    waiting = (Notice(NoticeCode.SCANNER_STARTING),)
    assert repo.set_notices("d1", DocumentStatus.SCANNING, waiting, T0) is True
    assert repo.get("d1").notices == waiting  # type: ignore[union-attr]
    assert repo.set_notices("d1", DocumentStatus.QUEUED, (), T0) is False
    assert repo.start_parsing("d1", T0) is False  # not scanned yet
    assert repo.finish_scan("d1", T0) is True
    scanned = repo.get("d1")
    assert scanned is not None
    assert (scanned.status, scanned.notices) == (DocumentStatus.QUEUED, ())
    assert repo.finish_scan("d1", T0) is False


def test_malware_verdict_is_stored_with_params(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc(status=DocumentStatus.SCANNING))
    params = {"signature": "Eicar-Test-Signature"}
    assert repo.mark_failed("d1", ErrorCode.MALWARE_DETECTED, T0, params) is True
    failed = repo.get("d1")
    assert failed is not None
    assert (failed.status, failed.error_code) == (DocumentStatus.FAILED, ErrorCode.MALWARE_DETECTED)
    assert failed.error_params == params


def test_rescan_takes_a_failed_document_back_to_scanning(repo: SqliteDocumentRepository) -> None:
    repo.insert(_doc(status=DocumentStatus.SCANNING))
    assert repo.rescan("d1", T0) is False  # only failed documents
    repo.mark_failed("d1", ErrorCode.MALWARE_SCAN_FAILED, T0, {"x": 1})
    assert repo.rescan("d1", T0) is True
    again = repo.get("d1")
    assert again is not None
    assert (again.status, again.error_code, again.error_params) == (
        DocumentStatus.SCANNING,
        None,
        {},
    )


# Chat attachments ----------------------------------------------------------------------


def _chat(repo: SqliteDocumentRepository, chat_id: str) -> None:
    with repo._db.connect() as conn:
        conn.execute(
            "INSERT INTO chats (id, created_at, updated_at) VALUES (?, 't', 't')", (chat_id,)
        )


def test_attachments_are_not_library_documents(repo: SqliteDocumentRepository) -> None:
    _chat(repo, "c1")
    repo.insert(_doc("lib", "a" * 64))
    repo.insert(_doc("att", "b" * 64, in_library=False), attach_to="c1")
    assert [d.id for d in repo.list_library()] == ["lib"]
    assert {d.id for d in repo.list_visible()} == {"lib", "att"}
    assert [d.id for d in repo.list_attachments("c1")] == ["att"]
    attached = repo.get("att")
    assert attached is not None and attached.in_library is False


def test_insert_into_a_deleted_chat_fails_and_leaves_no_row(
    repo: SqliteDocumentRepository,
) -> None:
    with pytest.raises(AppError) as caught:
        repo.insert(_doc("att", in_library=False), attach_to="gone")
    assert caught.value.code is ErrorCode.CHAT_NOT_FOUND
    assert repo.get("att") is None


def test_attach_and_add_to_library(repo: SqliteDocumentRepository) -> None:
    _chat(repo, "c1")
    _chat(repo, "c2")
    repo.insert(_doc("att", in_library=False), attach_to="c1")
    assert repo.attach("c2", "att", T0) is True
    assert repo.attach("c2", "att", T0) is True  # idempotent
    assert repo.attach("gone", "att", T0) is False
    assert [d.id for d in repo.list_attachments("c2")] == ["att"]
    assert repo.add_to_library("att", T0) is True
    assert [d.id for d in repo.list_library()] == ["att"]
    assert repo.add_to_library("missing", T0) is False


def test_unreferenced_keeps_library_and_still_attached_documents(
    repo: SqliteDocumentRepository,
) -> None:
    _chat(repo, "c1")
    _chat(repo, "c2")
    repo.insert(_doc("only", "a" * 64, in_library=False), attach_to="c1")
    repo.insert(_doc("shared", "b" * 64, in_library=False), attach_to="c1")
    repo.attach("c2", "shared", T0)
    repo.insert(_doc("lib", "c" * 64), attach_to="c1")
    with repo._db.connect() as conn:
        conn.execute("DELETE FROM chats WHERE id = 'c1'")
    assert repo.unreferenced(["only", "shared", "lib", "missing"]) == ["only"]


def test_detach(repo: SqliteDocumentRepository) -> None:
    _chat(repo, "c1")
    repo.insert(_doc("att", in_library=False), attach_to="c1")
    assert repo.detach("c1", "att") is True
    assert repo.detach("c1", "att") is False
    assert repo.unreferenced(["att"]) == ["att"]
