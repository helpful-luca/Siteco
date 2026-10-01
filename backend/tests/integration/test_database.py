import sqlite3
from pathlib import Path

import pytest

from docchat.adapters.sqlite.database import SCHEMA_VERSION, Database

EXPECTED_TABLES = {
    "preferences",
    "documents",
    "chats",
    "chat_documents",
    "chat_attachments",
    "messages",
    "usage_ledger",
}


@pytest.fixture
def db(tmp_path: Path) -> Database:
    database = Database(tmp_path / "data" / "app.db")
    database.migrate()
    return database


def test_migrate_creates_all_tables_and_sets_version(db: Database) -> None:
    with db.connect() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert tables >= EXPECTED_TABLES
    assert version == SCHEMA_VERSION


def test_migrate_is_idempotent(db: Database) -> None:
    db.migrate()
    assert db.ping() is True


def test_connections_enforce_foreign_keys_and_wal(db: Database) -> None:
    with db.connect() as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_document_status_is_constrained(db: Database) -> None:
    with db.connect() as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO documents (id, filename, kind, size_bytes, sha256, status,"
            " created_at, updated_at) VALUES ('d', 'a.pdf', 'pdf', 1, 'x', 'bogus', 't', 't')"
        )


def test_scanning_is_a_valid_document_status(db: Database) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO documents (id, filename, kind, size_bytes, sha256, status,"
            " created_at, updated_at) VALUES ('d', 'a.pdf', 'pdf', 1, 'x', 'scanning', 't', 't')"
        )


def test_deleting_a_chat_cascades_to_messages(db: Database) -> None:
    with db.connect() as conn:
        conn.execute("INSERT INTO chats (id, created_at, updated_at) VALUES ('c', 't', 't')")
        conn.execute(
            "INSERT INTO messages (id, chat_id, role, created_at) VALUES ('m', 'c', 'user', 't')"
        )
        conn.execute("DELETE FROM chats WHERE id = 'c'")
        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0


def test_ping_false_when_directory_missing(tmp_path: Path) -> None:
    assert Database(tmp_path / "missing" / "app.db").ping() is False


def test_version_1_databases_are_migrated_in_place(tmp_path: Path) -> None:
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE documents (id TEXT PRIMARY KEY, error_code TEXT);"
            "CREATE TABLE messages (id TEXT PRIMARY KEY);"
            "INSERT INTO documents VALUES ('d1', NULL); PRAGMA user_version = 1;"
        )
    Database(path).migrate()
    with sqlite3.connect(path) as conn:
        row = conn.execute("SELECT error_params FROM documents WHERE id = 'd1'").fetchone()
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert (row[0], version) == ("{}", SCHEMA_VERSION)


def test_version_2_databases_get_message_notices_and_sources_mode(tmp_path: Path) -> None:
    path = tmp_path / "v2.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE documents (id TEXT PRIMARY KEY);"
            "CREATE TABLE messages (id TEXT PRIMARY KEY);"
            "INSERT INTO messages VALUES ('m1'); PRAGMA user_version = 2;"
        )
    Database(path).migrate()
    with sqlite3.connect(path) as conn:
        row = conn.execute("SELECT notices, sources_mode FROM messages").fetchone()
    assert row == ("[]", None)


def test_version_3_databases_get_the_error_request_id(tmp_path: Path) -> None:
    path = tmp_path / "v3.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE documents (id TEXT PRIMARY KEY);"
            "CREATE TABLE messages (id TEXT PRIMARY KEY);"
            "INSERT INTO messages VALUES ('m1'); PRAGMA user_version = 3;"
        )
    Database(path).migrate()
    with sqlite3.connect(path) as conn:
        row = conn.execute("SELECT error_request_id FROM messages").fetchone()
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    assert (row[0], version) == (None, SCHEMA_VERSION)


def test_a_migration_finished_by_another_process_meanwhile_is_not_run_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two processes start at once and both read version 2. The second must re-read the
    version inside its write transaction, or its ALTER TABLEs fail with a duplicate column."""
    path = tmp_path / "race.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE documents (id TEXT PRIMARY KEY);"
            "CREATE TABLE messages (id TEXT PRIMARY KEY); PRAGMA user_version = 2;"
        )
    Database(path).migrate()  # the other process wins the race
    reads = iter([2])  # what this process read before the other one committed
    real = Database._version

    def stale_first(conn: sqlite3.Connection) -> int:
        return next(reads, None) or real(conn)

    monkeypatch.setattr(Database, "_version", staticmethod(stale_first))
    Database(path).migrate()
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_version_4_documents_become_library_documents(tmp_path: Path) -> None:
    """Before chat attachments every document was in the library, and stays there."""
    path = tmp_path / "v4.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE documents (id TEXT PRIMARY KEY);"
            "CREATE TABLE chats (id TEXT PRIMARY KEY);"
            "CREATE TABLE messages (id TEXT PRIMARY KEY);"
            "INSERT INTO documents VALUES ('d1'); INSERT INTO chats VALUES ('c1');"
            "PRAGMA user_version = 4;"
        )
    db = Database(path)
    db.migrate()
    with db.connect() as conn:
        assert conn.execute("SELECT in_library FROM documents").fetchone()[0] == 1
        conn.execute(
            "INSERT INTO chat_attachments (chat_id, document_id, created_at)"
            " VALUES ('c1', 'd1', 't')"
        )
        conn.execute("DELETE FROM chats WHERE id = 'c1'")
        assert conn.execute("SELECT COUNT(*) FROM chat_attachments").fetchone()[0] == 0


def test_version_5_documents_accept_html_and_keep_their_relations(tmp_path: Path) -> None:
    """SQLite cannot change a CHECK constraint in place: the table is rebuilt, and the chats
    that point at its documents must not lose them (no cascade during the rebuild)."""
    from importlib.resources import files

    schema = files("docchat.adapters.sqlite").joinpath("schema.sql").read_text("utf-8")
    path = tmp_path / "v5.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(schema.replace(", 'html'", ""))
        conn.executescript(
            "PRAGMA foreign_keys = ON;"
            "INSERT INTO documents (id, filename, kind, size_bytes, sha256, status, created_at,"
            " updated_at, in_library) VALUES ('d1', 'a.pdf', 'pdf', 1, 'x', 'ready', 't', 't', 0);"
            "INSERT INTO chats (id, created_at, updated_at) VALUES ('c1', 't', 't');"
            "INSERT INTO chat_documents VALUES ('c1', 'd1');"
            "INSERT INTO chat_attachments VALUES ('c1', 'd1', 't');"
            "PRAGMA user_version = 5;"
        )
    db = Database(path)
    db.migrate()
    with db.connect() as conn:
        assert conn.execute("SELECT in_library FROM documents").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM chat_documents").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM chat_attachments").fetchone()[0] == 1
        conn.execute(
            "INSERT INTO documents (id, filename, kind, size_bytes, sha256, status, created_at,"
            " updated_at) VALUES ('d2', 'a.html', 'html', 1, 'y', 'ready', 't', 't')"
        )
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
    assert "ix_documents_status" in names and "documents_new" not in names
