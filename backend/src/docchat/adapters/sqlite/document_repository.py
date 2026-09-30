"""Documents table. Status changes are compare-and-set updates, so a delete always wins."""

import json
import sqlite3
from collections.abc import Sequence
from datetime import UTC, datetime

from docchat.adapters.sqlite.database import Database
from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode, NoticeCode
from docchat.domain.models import Document, Notice

_ACTIVE = (DocumentStatus.QUEUED, DocumentStatus.PARSING, DocumentStatus.EMBEDDING)


def _ts(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse_ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


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
        notices=notices,
        ready_at=_parse_ts(row["ready_at"]),
    )


def _placeholders(values: Sequence[object]) -> str:
    return ", ".join("?" * len(values))


class SqliteDocumentRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def _update(self, sql: str, params: Sequence[object]) -> bool:
        with self._db.connect() as conn:
            return conn.execute(sql, params).rowcount == 1

    def insert(self, document: Document) -> None:
        try:
            with self._db.connect() as conn:
                conn.execute(
                    "INSERT INTO documents (id, filename, kind, size_bytes, sha256, page_count,"
                    " status, progress, notices, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                    ),
                )
        except sqlite3.IntegrityError as exc:
            existing = self.find_by_sha256(document.sha256)
            if existing is None:
                raise
            raise AppError(
                ErrorCode.DUPLICATE_DOCUMENT, params={"existing_id": existing.id}
            ) from exc

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
            "UPDATE documents SET status = ?, progress = 0, error_code = NULL, notices = '[]',"
            " chunk_count = NULL, char_count = NULL, ready_at = NULL, updated_at = ?"
            f" WHERE id = ? AND status IN ({_placeholders(expected)})",
            [DocumentStatus.QUEUED.value, _ts(now), document_id, *expected],
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

    def mark_failed(self, document_id: str, code: ErrorCode, now: datetime) -> bool:
        expected = [s.value for s in _ACTIVE]
        return self._update(
            "UPDATE documents SET status = ?, error_code = ?, updated_at = ?"
            f" WHERE id = ? AND status IN ({_placeholders(expected)})",
            [DocumentStatus.FAILED.value, code.value, _ts(now), document_id, *expected],
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
