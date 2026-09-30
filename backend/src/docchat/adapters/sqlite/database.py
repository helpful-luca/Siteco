"""SQLite connection handling and schema migration via PRAGMA user_version."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path

SCHEMA_VERSION = 3

# Steps from one version to the next for databases created by an older release. A new database
# gets schema.sql, which already has the latest shape.
_MIGRATIONS: dict[int, str] = {
    2: "ALTER TABLE documents ADD COLUMN error_params TEXT NOT NULL DEFAULT '{}';",
    3: "ALTER TABLE messages ADD COLUMN sources_mode TEXT;\n"
    "ALTER TABLE messages ADD COLUMN notices TEXT NOT NULL DEFAULT '[]';",
}


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """One short-lived connection per unit of work. Autocommit unless BEGIN is issued."""
        conn = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        try:
            yield conn
        finally:
            conn.close()

    def migrate(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            current = conn.execute("PRAGMA user_version").fetchone()[0]
            if current >= SCHEMA_VERSION:
                return
            if current == 0:
                script = files("docchat.adapters.sqlite").joinpath("schema.sql").read_text("utf-8")
            else:
                script = "\n".join(_MIGRATIONS[v] for v in range(current + 1, SCHEMA_VERSION + 1))
            conn.executescript(
                f"BEGIN;\n{script}\nPRAGMA user_version = {SCHEMA_VERSION};\nCOMMIT;"
            )

    def ping(self) -> bool:
        if not self.path.parent.exists():
            return False
        try:
            with self.connect() as conn:
                conn.execute("SELECT 1").fetchone()
        except sqlite3.Error:
            return False
        return True
