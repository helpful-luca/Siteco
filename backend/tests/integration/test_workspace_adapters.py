"""SQLite pieces of preferences, redaction, retention and the workspace wipe."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from docchat.adapters.sqlite.chat_repository import SqliteChatRepository
from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.preferences_store import SqlitePreferencesStore
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.domain.chat_models import Chat, Citation, Message, SourceSnapshot
from docchat.domain.enums import ChatScope, Locale, MessageRole, Theme
from docchat.domain.preferences import default_preferences
from docchat.domain.usage import UsageDay

T0 = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)


@pytest.fixture
def db(tmp_path: Path) -> Database:
    database = Database(tmp_path / "app.db")
    database.migrate()
    return database


def _answer(msg_id: str, chat_id: str, *document_ids: str) -> Message:
    sources = tuple(
        SourceSnapshot(f"s-{d}", i + 1, d, f"{d}.pdf", 1, f"Text aus {d}.")
        for i, d in enumerate(document_ids)
    )
    return Message(
        msg_id,
        chat_id,
        MessageRole.ASSISTANT,
        T0,
        content="Antwort.",
        sources=sources,
        citations=tuple(Citation(s.id, 0, 1, s.snippet, 8) for s in sources),
    )


def _chats(db: Database) -> SqliteChatRepository:
    repo = SqliteChatRepository(db)
    repo.insert_chat(Chat("c1", ChatScope.ALL, T0, T0))
    repo.insert_chat(Chat("c2", ChatScope.ALL, T0, T0 + timedelta(days=40)))
    repo.insert_messages([_answer("a1", "c1", "gone", "kept"), _answer("a2", "c2", "kept")])
    return repo


def test_preferences_round_trip_and_clear(db: Database) -> None:
    store = SqlitePreferencesStore(db)
    assert store.load() is None
    prefs = default_preferences("claude-sonnet-5-5")
    changed = type(prefs)(**{**prefs.__dict__, "locale": Locale.EN, "theme": Theme.DARK})
    store.save(changed, T0)
    assert store.load() == changed
    store.clear()
    assert store.load() is None


def test_unreadable_preferences_count_as_none(db: Database) -> None:
    with db.connect() as conn:
        conn.execute("INSERT INTO preferences (id, data, updated_at) VALUES (1, '{\"x\":1}', 'x')")
    assert SqlitePreferencesStore(db).load() is None


def test_redacts_the_cited_text_of_one_document_in_every_chat(db: Database) -> None:
    repo = _chats(db)
    assert repo.redact_document("gone") == 1
    a1 = repo.get_message("a1")
    assert a1 is not None
    assert {s.document_id: s.snippet for s in a1.sources} == {"gone": "", "kept": "Text aus kept."}
    assert [c.cited_text for c in a1.citations] == ["", "Text aus kept."]
    assert repo.redact_document("gone") == 0  # idempotent


def test_redacts_snapshots_of_documents_that_no_longer_exist(db: Database) -> None:
    repo = _chats(db)
    assert repo.redact_missing({"kept"}) == 1
    a1 = repo.get_message("a1")
    assert a1 is not None and a1.sources[0].snippet == ""
    assert repo.redact_missing({"kept"}) == 0


def test_idle_chats_and_delete_all(db: Database) -> None:
    repo = _chats(db)
    assert repo.chats_idle_since(T0 + timedelta(days=1)) == ["c1"]
    assert repo.delete_all_chats() == 2
    assert repo.list_chats() == []
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0


def test_usage_of_a_day(db: Database) -> None:
    ledger = SqliteUsageLedger(db)
    assert ledger.usage_on("2026-09-30") == UsageDay(0.0, 0, 0, 0)
    ledger.record("2026-09-30", 0.01, 100, 20)
    ledger.record("2026-09-30", 0.02, 50, 10)
    assert ledger.usage_on("2026-09-30") == UsageDay(0.03, 2, 150, 30)


def test_vacuum_runs(db: Database) -> None:
    db.vacuum()


def test_connections_zero_deleted_content(db: Database) -> None:
    with db.connect() as conn:
        assert conn.execute("PRAGMA secure_delete").fetchone()[0] == 1


def test_checkpoint_empties_the_log_and_reports_a_blocking_reader(db: Database) -> None:
    wal = db.path.with_name(db.path.name + "-wal")
    # SQLite empties the log itself when the last connection closes; the app has several open.
    with db.connect() as other:
        other.execute("SELECT COUNT(*) FROM preferences").fetchone()
        SqlitePreferencesStore(db).save(default_preferences("claude-sonnet-5-5"), T0)
        assert wal.stat().st_size > 0
        assert db.checkpoint()
        assert wal.stat().st_size == 0

        other.execute("BEGIN")
        other.execute("SELECT * FROM preferences").fetchall()  # holds a read snapshot
        SqlitePreferencesStore(db).clear()
        assert not db.checkpoint(attempts=2, pause_s=0.01)
        other.execute("COMMIT")
        assert db.checkpoint()
        assert wal.stat().st_size == 0
