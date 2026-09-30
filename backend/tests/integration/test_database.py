import sqlite3
from pathlib import Path

import pytest

from docchat.adapters.sqlite.database import SCHEMA_VERSION, Database

EXPECTED_TABLES = {
    "preferences",
    "documents",
    "chats",
    "chat_documents",
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
