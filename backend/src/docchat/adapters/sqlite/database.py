"""SQLite connection handling and schema migration via PRAGMA user_version."""

import sqlite3
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path

SCHEMA_VERSION = 7

# Version 6 documents: the kind may be `html`. SQLite cannot change a CHECK constraint, so the
# table is rebuilt (create, copy, drop, rename) with foreign keys off for the migration.
_DOCUMENTS_V6 = """CREATE TABLE documents_new (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'txt', 'md', 'html')),
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL UNIQUE,
  page_count    INTEGER,
  chunk_count   INTEGER,
  char_count    INTEGER,
  status        TEXT NOT NULL CHECK (status IN
                ('scanning', 'queued', 'parsing', 'embedding', 'ready', 'failed', 'deleting')),
  progress      REAL NOT NULL DEFAULT 0,
  error_code    TEXT,
  error_params  TEXT NOT NULL DEFAULT '{}',
  notices       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  ready_at      TEXT,
  in_library    INTEGER NOT NULL DEFAULT 1 CHECK (in_library IN (0, 1))
)"""


def _documents_accept_html(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'documents'"
    ).fetchone()
    if row is None or "kind IN ('pdf', 'txt', 'md')" not in row[0]:
        return  # no kind constraint to widen
    old = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
    conn.execute(_DOCUMENTS_V6)
    columns = ", ".join(
        r[1] for r in conn.execute("PRAGMA table_info(documents_new)") if r[1] in old
    )
    conn.execute(f"INSERT INTO documents_new ({columns}) SELECT {columns} FROM documents")
    conn.execute("DROP TABLE documents")
    conn.execute("ALTER TABLE documents_new RENAME TO documents")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_documents_status ON documents(status)")


# Steps from one version to the next for databases created by an older release. A new database
# gets schema.sql, which already has the latest shape. A step is SQL or, where SQL alone cannot
# say it, a function.
_MIGRATIONS: dict[int, str | Callable[[sqlite3.Connection], None]] = {
    2: "ALTER TABLE documents ADD COLUMN error_params TEXT NOT NULL DEFAULT '{}';",
    3: "ALTER TABLE messages ADD COLUMN sources_mode TEXT;\n"
    "ALTER TABLE messages ADD COLUMN notices TEXT NOT NULL DEFAULT '[]';",
    4: "ALTER TABLE messages ADD COLUMN error_request_id TEXT;",
    # Chat attachments; every existing document was uploaded to the library and stays there.
    5: "ALTER TABLE documents ADD COLUMN in_library INTEGER NOT NULL DEFAULT 1"
    " CHECK (in_library IN (0, 1));\n"
    "CREATE TABLE chat_attachments (\n"
    "  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,\n"
    "  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,\n"
    "  created_at TEXT NOT NULL,\n"
    "  PRIMARY KEY (chat_id, document_id)\n"
    ");\n"
    "CREATE INDEX ix_chat_attachments_document ON chat_attachments(document_id);",
    6: _documents_accept_html,
    7: "ALTER TABLE documents ADD COLUMN source_url TEXT;",
}


def _statements(script: str) -> list[str]:
    """Splits a script into complete statements. `executescript` would commit the open
    transaction first, so the steps run one by one inside it."""
    statements: list[str] = []
    pending = ""
    for line in script.splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            statements.append(pending.strip())
            pending = ""
    if pending.strip():
        statements.append(pending.strip())
    return statements


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """One short-lived connection per unit of work. Autocommit unless BEGIN is issued."""
        conn = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        # Freed pages and overwritten cells are zeroed, so deleted text does not linger.
        conn.execute("PRAGMA secure_delete = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def _version(conn: sqlite3.Connection) -> int:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])

    def migrate(self) -> None:
        """Brings the schema to SCHEMA_VERSION. Safe when two processes start at once: the
        steps run under a write lock, and the version is read again once the lock is held."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            if self._version(conn) >= SCHEMA_VERSION:
                return
            # A table rebuild drops the old table; with foreign keys on, that would cascade into
            # every row pointing at it. Checked again below before the commit.
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN IMMEDIATE")
            try:
                current = self._version(conn)  # another process may have migrated meanwhile
                if current < SCHEMA_VERSION:
                    for step in self._steps(current):
                        if callable(step):
                            step(conn)
                        else:
                            for statement in _statements(step):
                                conn.execute(statement)
                    if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
                        raise sqlite3.IntegrityError("migration left dangling references")
                    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    @staticmethod
    def _steps(current: int) -> list[str | Callable[[sqlite3.Connection], None]]:
        if current == 0:
            return [files("docchat.adapters.sqlite").joinpath("schema.sql").read_text("utf-8")]
        return [_MIGRATIONS[v] for v in range(current + 1, SCHEMA_VERSION + 1)]

    def vacuum(self) -> None:
        """After a mass deletion: rewrites the file so deleted content is gone from disk too.
        The caller empties the write-ahead log with `checkpoint`."""
        with self.connect() as conn:
            conn.execute("VACUUM")

    def checkpoint(self, attempts: int = 5, pause_s: float = 0.1) -> bool:
        """`wal_checkpoint(TRUNCATE)` reports a busy reader in its result instead of raising;
        retried a few times, False if the log could not be emptied."""
        for attempt in range(attempts):
            with self.connect() as conn:
                conn.execute(
                    "PRAGMA busy_timeout = 200"
                )  # a busy reader is reported, not waited out
                busy = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0]
            if busy == 0:
                return True
            if attempt < attempts - 1:
                time.sleep(pause_s)
        return False

    def ping(self) -> bool:
        if not self.path.parent.exists():
            return False
        try:
            with self.connect() as conn:
                conn.execute("SELECT 1").fetchone()
        except sqlite3.Error:
            return False
        return True
