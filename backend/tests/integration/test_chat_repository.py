import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from docchat.adapters.sqlite.chat_repository import SqliteChatRepository
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.domain.chat_models import Chat, Citation, Message, SourceSnapshot
from docchat.domain.enums import (
    ChatScope,
    DocumentKind,
    DocumentStatus,
    Effort,
    Lane,
    MessageRole,
    MessageStatus,
    SourcesMode,
    TitleSource,
)
from docchat.domain.errors import ErrorCode, NoticeCode
from docchat.domain.models import Document, Notice
from docchat.domain.ports import DuplicateMessage
from docchat.domain.usage import TokenUsage

T0 = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


@pytest.fixture
def db(tmp_path: Path) -> Database:
    database = Database(tmp_path / "app.db")
    database.migrate()
    return database


@pytest.fixture
def repo(db: Database) -> SqliteChatRepository:
    return SqliteChatRepository(db)


def add_document(db: Database, doc_id: str) -> None:
    SqliteDocumentRepository(db).insert(
        Document(doc_id, "a.pdf", DocumentKind.PDF, 1, doc_id * 4, DocumentStatus.READY, T0, T0)
    )


def chat(chat_id: str = "c1", **changes: object) -> Chat:
    return replace(Chat(chat_id, ChatScope.ALL, T0, T0), **changes)  # type: ignore[arg-type]


def user(msg_id: str = "u1", chat_id: str = "c1", cmid: str | None = "cm1", at: int = 0) -> Message:
    return Message(
        msg_id,
        chat_id,
        MessageRole.USER,
        T0 + timedelta(seconds=at),
        content="Welche Schutzart?",
        client_message_id=cmid,
    )


def test_chat_round_trip_with_selection(db: Database, repo: SqliteChatRepository) -> None:
    add_document(db, "d1")
    add_document(db, "d2")
    created = chat(scope=ChatScope.SELECTED, document_ids=("d2", "d1"))
    repo.insert_chat(created)
    assert repo.get_chat("c1") == created
    assert repo.get_chat("missing") is None


def test_deleting_a_document_removes_it_from_the_selection(
    db: Database, repo: SqliteChatRepository
) -> None:
    add_document(db, "d1")
    repo.insert_chat(chat(scope=ChatScope.SELECTED, document_ids=("d1",)))
    SqliteDocumentRepository(db).delete("d1")
    stored = repo.get_chat("c1")
    assert stored is not None and stored.document_ids == ()


def test_list_is_newest_first_with_message_counts(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat("old"))
    repo.insert_chat(chat("new", updated_at=T0 + timedelta(hours=1)))
    repo.insert_message(user(chat_id="new"))
    summaries = repo.list_chats()
    assert [(s.chat.id, s.message_count) for s in summaries] == [("new", 1), ("old", 0)]
    assert repo.count_chats() == 2


def test_update_replaces_title_scope_and_selection(
    db: Database, repo: SqliteChatRepository
) -> None:
    add_document(db, "d1")
    repo.insert_chat(chat())
    changed = chat(
        title="Mira",
        title_source=TitleSource.USER,
        scope=ChatScope.SELECTED,
        document_ids=("d1",),
        updated_at=T0 + timedelta(minutes=1),
    )
    assert repo.update_chat(changed)
    assert repo.get_chat("c1") == changed
    assert not repo.update_chat(chat("missing"))


def test_delete_chat_cascades_to_messages(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat())
    repo.insert_message(user())
    assert repo.delete_chat("c1")
    assert repo.get_message("u1") is None
    assert not repo.delete_chat("c1")


def test_duplicate_client_message_id_raises(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat())
    repo.insert_message(user())
    with pytest.raises(DuplicateMessage):
        repo.insert_message(user("u2"))
    assert repo.find_user_message("c1", "cm1") == user()


def test_assistant_message_round_trip_and_save(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat())
    repo.insert_message(user())
    answer = Message(
        "a1",
        "c1",
        MessageRole.ASSISTANT,
        T0 + timedelta(seconds=1),
        status=MessageStatus.STREAMING,
        parent_id="u1",
        model="claude-sonnet-5-5",
        effort=Effort.LOW,
        lane=Lane.A,
    )
    repo.insert_message(answer)
    final = replace(
        answer,
        content="Die Mira hat IP66.",
        status=MessageStatus.COMPLETE,
        sources=(SourceSnapshot("k1", 1, "d1", "a.pdf", 2, "Schutzart IP66"),),
        sources_mode=SourcesMode.RETRIEVAL,
        citations=(Citation("k1", 0, 1, "Schutzart IP66.", 17),),
        notices=(Notice(NoticeCode.MODEL_SWITCHED, {"old": "a", "new": "b"}),),
        usage=TokenUsage(10, 5, 3, 1),
        cost_usd=0.001,
        ttft_ms=100,
        total_ms=300,
        error_code=ErrorCode.LLM_OVERLOADED,
    )
    assert repo.save_message(final)
    assert repo.get_message("a1") == final
    assert repo.answer_in_lane("u1", Lane.A) == final
    assert repo.answer_in_lane("u1", Lane.B) is None
    assert [m.id for m in repo.list_messages("c1")] == ["u1", "a1"]
    assert repo.count_messages("c1") == 2


def test_interrupt_streaming_marks_leftovers(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat())
    repo.insert_message(user())
    repo.insert_message(
        Message("a1", "c1", MessageRole.ASSISTANT, T0, status=MessageStatus.STREAMING)
    )
    assert repo.interrupt_streaming() == 1
    stored = repo.get_message("a1")
    assert stored is not None and stored.status is MessageStatus.INTERRUPTED


def test_usage_ledger_adds_up_per_day(db: Database) -> None:
    ledger = SqliteUsageLedger(db)
    ledger.record("2026-09-30", 0.25, 100, 10)
    ledger.record("2026-09-30", 0.5, 50, 5)
    ledger.record("2026-10-01", 1.0, 1, 1)
    assert ledger.cost_on("2026-09-30") == pytest.approx(0.75)
    assert ledger.cost_on("2026-09-29") == 0.0


def test_touch_names_only_unnamed_auto_chats(repo: SqliteChatRepository) -> None:
    repo.insert_chat(chat("auto"))
    repo.insert_chat(chat("user", title="Meins", title_source=TitleSource.USER))
    later = T0 + timedelta(minutes=5)
    for chat_id in ("auto", "user"):
        repo.touch_chat(chat_id, later, auto_title="Erste Frage")
    repo.touch_chat("auto", later, auto_title="Zweite Frage")
    auto, user = repo.get_chat("auto"), repo.get_chat("user")
    assert auto is not None and user is not None
    assert (auto.title, auto.updated_at) == ("Erste Frage", later)
    assert (user.title, user.updated_at) == ("Meins", later)


def test_question_and_placeholder_are_saved_together_or_not_at_all(
    repo: SqliteChatRepository,
) -> None:
    repo.insert_chat(chat())
    repo.insert_message(user("existing", cmid=None))
    clash = Message("existing", "c1", MessageRole.ASSISTANT, T0)  # primary key taken
    with pytest.raises(sqlite3.IntegrityError):
        repo.insert_messages([user(), clash])
    assert repo.find_user_message("c1", "cm1") is None
    repo.insert_messages([user(), Message("a1", "c1", MessageRole.ASSISTANT, T0, parent_id="u1")])
    assert [m.id for m in repo.list_messages("c1")] == ["existing", "u1", "a1"]
    with pytest.raises(DuplicateMessage):
        repo.insert_messages([user("u9"), Message("a9", "c1", MessageRole.ASSISTANT, T0)])
    assert repo.get_message("a9") is None
