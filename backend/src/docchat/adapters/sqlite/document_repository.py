"""Documents table. Status changes are compare-and-set updates, so a delete always wins."""

import json
import sqlite3
from collections.abc import Collection, Mapping, Sequence
from datetime import datetime

from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.timestamps import from_db as _parse_ts
from docchat.adapters.sqlite.timestamps import to_db as _ts
from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode, NoticeCode
from docchat.domain.models import Document, Notice

_ACTIVE = (DocumentStatus.QUEUED, DocumentStatus.PARSING, DocumentStatus.EMBEDDING)
_FAILABLE = (DocumentStatus.SCANNING, *_ACTIVE)
# Resets everything a previous run produced.
_CLEAN_SLATE = (
    "progress = 0, error_code = NULL, error_params = '{}', notices = '[]',"
    " chunk_count = NULL, char_count = NULL, ready_at = NULL"
)


def _notices_json(notices: Sequence[Notice]) -> str:
    return json.dumps([{"code": n.code.value, "params": dict(n.params)} for n in notices])


def _row_to_document(row: sqlite3.Row) -> Document:
    notices = tuple(
        Notice(NoticeCode(n["code"]), n.get("params", {})) for n in json.loads(row["notices"])
    )
    created = _parse_ts(row["created_at"])
    updated = _parse_ts(row["updated_at"])
    assert created is not None and updated is not None
    return Document(
        id=row["id"],
        filename=row["filename"],
        kind=DocumentKind(row["kind"]),
        size_bytes=row["size_bytes"],
        sha256=row["sha256"],
        status=DocumentStatus(row["status"]),
        created_at=created,
        updated_at=updated,
        page_count=row["page_count"],
        chunk_count=row["chunk_count"],
        char_count=row["char_count"],
        progress=row["progress"],
        error_code=ErrorCode(row["error_code"]) if row["error_code"] else None,
        error_params=json.loads(row["error_params"]),
        notices=notices,
        ready_at=_parse_ts(row["ready_at"]),
        in_library=bool(row["in_library"]),
    )


def _placeholders(values: Sequence[object]) -> str:
    return ", ".join("?" * len(values))


class SqliteDocumentRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def _update(self, sql: str, params: Sequence[object]) -> bool:
        with self._db.connect() as conn:
            return conn.execute(sql, params).rowcount == 1

    def insert(self, document: Document, *, attach_to: str | None = None) -> None:
        """`attach_to`: the chat the document was uploaded into, in the same transaction, so a
        chat deleted meanwhile leaves no row behind (CHAT_NOT_FOUND)."""
        try:
            with self._db.connect() as conn:
                conn.execute("BEGIN")
                try:
                    conn.execute(
                        "INSERT INTO documents (id, filename, kind, size_bytes, sha256,"
                        " page_count, status, progress, notices, created_at, updated_at,"
                        " in_library) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            document.id,
                            document.filename,
                            document.kind.value,
                            document.size_bytes,
                            document.sha256,
                            document.page_count,
                            document.status.value,
                            document.progress,
                            _notices_json(document.notices),
                            _ts(document.created_at),
                            _ts(document.updated_at),
                            int(document.in_library),
                        ),
                    )
                    if attach_to is not None:
                        conn.execute(
                            "INSERT INTO chat_attachments (chat_id, document_id, created_at)"
                            " VALUES (?, ?, ?)",
                            (attach_to, document.id, _ts(document.created_at)),
                        )
                    conn.execute("COMMIT")
                except BaseException:
                    conn.execute("ROLLBACK")
                    raise
        except sqlite3.IntegrityError as exc:
            existing = self.find_by_sha256(document.sha256)
            if existing is not None:
                raise AppError(
                    ErrorCode.DUPLICATE_DOCUMENT, params={"existing_id": existing.id}
                ) from exc
            if attach_to is not None:
                raise AppError(ErrorCode.CHAT_NOT_FOUND) from exc
            raise

    def get(self, document_id: str) -> Document | None:
        with self._db.connect() as conn:
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        return _row_to_document(row) if row else None

    def list_visible(self) -> list[Document]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE status != ? ORDER BY created_at DESC, id",
                (DocumentStatus.DELETING.value,),
            ).fetchall()
        return [_row_to_document(r) for r in rows]

    def list_library(self) -> list[Document]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE status != ? AND in_library = 1"
                " ORDER BY created_at DESC, id",
                (DocumentStatus.DELETING.value,),
            ).fetchall()
        return [_row_to_document(r) for r in rows]

    def list_attachments(self, chat_id: str) -> list[Document]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT d.* FROM documents d JOIN chat_attachments a ON a.document_id = d.id"
                " WHERE a.chat_id = ? AND d.status != ? ORDER BY a.created_at DESC, d.id",
                (chat_id, DocumentStatus.DELETING.value),
            ).fetchall()
        return [_row_to_document(r) for r in rows]

    def attach(self, chat_id: str, document_id: str, now: datetime) -> bool:
        """False if the chat or the document is gone. Attaching twice is harmless."""
        try:
            with self._db.connect() as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO chat_attachments (chat_id, document_id, created_at)"
                    " VALUES (?, ?, ?)",
                    (chat_id, document_id, _ts(now)),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def detach(self, chat_id: str, document_id: str) -> bool:
        with self._db.connect() as conn:
            return (
                conn.execute(
                    "DELETE FROM chat_attachments WHERE chat_id = ? AND document_id = ?",
                    (chat_id, document_id),
                ).rowcount
                == 1
            )

    def add_to_library(self, document_id: str, now: datetime) -> bool:
        return self._update(
            "UPDATE documents SET in_library = 1, updated_at = ? WHERE id = ? AND status != ?",
            (_ts(now), document_id, DocumentStatus.DELETING.value),
        )

    def unreferenced(self, document_ids: Collection[str]) -> list[str]:
        """Of these, the documents outside the library that no chat holds any more."""
        ids = list(document_ids)
        if not ids:
            return []
        with self._db.connect() as conn:
            rows = conn.execute(
                f"SELECT d.id FROM documents d WHERE d.id IN ({_placeholders(ids)})"
                " AND d.in_library = 0"
                " AND NOT EXISTS (SELECT 1 FROM chat_attachments a WHERE a.document_id = d.id)"
                " ORDER BY d.created_at, d.id",
                ids,
            ).fetchall()
        return [r[0] for r in rows]

    def list_by_status(self, *statuses: DocumentStatus) -> list[Document]:
        values = [s.value for s in statuses]
        with self._db.connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM documents WHERE status IN ({_placeholders(values)})"
                " ORDER BY created_at",
                values,
            ).fetchall()
        return [_row_to_document(r) for r in rows]

    def find_by_sha256(self, sha256: str) -> Document | None:
        with self._db.connect() as conn:
            row = conn.execute("SELECT * FROM documents WHERE sha256 = ?", (sha256,)).fetchone()
        return _row_to_document(row) if row else None

    def total_size_bytes(self) -> int:
        with self._db.connect() as conn:
            total = conn.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM documents").fetchone()
        return int(total[0])

    def all_ids(self) -> set[str]:
        with self._db.connect() as conn:
            return {r[0] for r in conn.execute("SELECT id FROM documents")}

    def requeue(self, document_id: str, now: datetime) -> bool:
        expected = [s.value for s in (*_ACTIVE, DocumentStatus.FAILED)]
        return self._update(
            f"UPDATE documents SET status = ?, {_CLEAN_SLATE}, updated_at = ?"
            f" WHERE id = ? AND status IN ({_placeholders(expected)})",
            [DocumentStatus.QUEUED.value, _ts(now), document_id, *expected],
        )

    def rescan(self, document_id: str, now: datetime) -> bool:
        return self._update(
            f"UPDATE documents SET status = ?, {_CLEAN_SLATE}, updated_at = ?"
            " WHERE id = ? AND status = ?",
            (DocumentStatus.SCANNING.value, _ts(now), document_id, DocumentStatus.FAILED.value),
        )

    def set_notices(
        self, document_id: str, status: DocumentStatus, notices: Sequence[Notice], now: datetime
    ) -> bool:
        return self._update(
            "UPDATE documents SET notices = ?, updated_at = ? WHERE id = ? AND status = ?",
            (_notices_json(notices), _ts(now), document_id, status.value),
        )

    def finish_scan(self, document_id: str, now: datetime) -> bool:
        return self._update(
            "UPDATE documents SET status = ?, notices = '[]', updated_at = ?"
            " WHERE id = ? AND status = ?",
            (DocumentStatus.QUEUED.value, _ts(now), document_id, DocumentStatus.SCANNING.value),
        )

    def start_parsing(self, document_id: str, now: datetime) -> bool:
        return self._update(
            "UPDATE documents SET status = ?, progress = 0, updated_at = ?"
            " WHERE id = ? AND status = ?",
            (DocumentStatus.PARSING.value, _ts(now), document_id, DocumentStatus.QUEUED.value),
        )

    def set_progress(
        self,
        document_id: str,
        status: DocumentStatus,
        progress: float,
        now: datetime,
        *,
        page_count: int | None = None,
    ) -> bool:
        return self._update(
            "UPDATE documents SET progress = ?, page_count = COALESCE(?, page_count),"
            " updated_at = ? WHERE id = ? AND status = ?",
            (min(max(progress, 0.0), 1.0), page_count, _ts(now), document_id, status.value),
        )

    def start_embedding(
        self,
        document_id: str,
        now: datetime,
        *,
        page_count: int | None,
        chunk_count: int,
        char_count: int,
        notices: Sequence[Notice],
    ) -> bool:
        return self._update(
            "UPDATE documents SET status = ?, progress = 0, page_count = ?, chunk_count = ?,"
            " char_count = ?, notices = ?, updated_at = ? WHERE id = ? AND status = ?",
            (
                DocumentStatus.EMBEDDING.value,
                page_count,
                chunk_count,
                char_count,
                _notices_json(notices),
                _ts(now),
                document_id,
                DocumentStatus.PARSING.value,
            ),
        )

    def mark_ready(self, document_id: str, now: datetime) -> bool:
        return self._update(
            "UPDATE documents SET status = ?, progress = 1, ready_at = ?, updated_at = ?"
            " WHERE id = ? AND status = ?",
            (
                DocumentStatus.READY.value,
                _ts(now),
                _ts(now),
                document_id,
                DocumentStatus.EMBEDDING.value,
            ),
        )

    def mark_failed(
        self,
        document_id: str,
        code: ErrorCode,
        now: datetime,
        params: Mapping[str, int | str] | None = None,
    ) -> bool:
        expected = [s.value for s in _FAILABLE]
        return self._update(
            "UPDATE documents SET status = ?, error_code = ?, error_params = ?, updated_at = ?"
            f" WHERE id = ? AND status IN ({_placeholders(expected)})",
            [
                DocumentStatus.FAILED.value,
                code.value,
                json.dumps(dict(params or {})),
                _ts(now),
                document_id,
                *expected,
            ],
        )

    def mark_deleting(self, document_id: str, now: datetime) -> Document | None:
        with self._db.connect() as conn:
            conn.execute(
                "UPDATE documents SET status = ?, updated_at = ? WHERE id = ?",
                (DocumentStatus.DELETING.value, _ts(now), document_id),
            )
        return self.get(document_id)

    def delete(self, document_id: str) -> None:
        with self._db.connect() as conn:
            conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
