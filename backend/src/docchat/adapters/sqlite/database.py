"""SQLite connection handling and schema migration via PRAGMA user_version."""

import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path

SCHEMA_VERSION = 4

# Steps from one version to the next for databases created by an older release. A new database
# gets schema.sql, which already has the latest shape.
_MIGRATIONS: dict[int, str] = {
    2: "ALTER TABLE documents ADD COLUMN error_params TEXT NOT NULL DEFAULT '{}';",
    3: "ALTER TABLE messages ADD COLUMN sources_mode TEXT;\n"
    "ALTER TABLE messages ADD COLUMN notices TEXT NOT NULL DEFAULT '[]';",
    4: "ALTER TABLE messages ADD COLUMN error_request_id TEXT;",
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
        # Freed pages and overwritten cells are zeroed, so deleted text does not linger in the
        # file (master spec 10b, 4).
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
            conn.execute("BEGIN IMMEDIATE")
            try:
                current = self._version(conn)  # another process may have migrated meanwhile
                if current < SCHEMA_VERSION:
                    for statement in _statements(self._script(current)):
                        conn.execute(statement)
                    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    @staticmethod
    def _script(current: int) -> str:
        if current == 0:
            return files("docchat.adapters.sqlite").joinpath("schema.sql").read_text("utf-8")
        return "\n".join(_MIGRATIONS[v] for v in range(current + 1, SCHEMA_VERSION + 1))

    def vacuum(self) -> None:
        """After a mass deletion: rewrites the file so deleted content is gone from disk too
        (master spec 10b, 4). The caller empties the write-ahead log with `checkpoint`."""
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
