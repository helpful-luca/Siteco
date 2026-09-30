"""Chats, their document selection and messages. Hand-written SQL, JSON for snapshots."""

import json
import sqlite3
from dataclasses import asdict
from typing import Any

from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.timestamps import from_db, to_db
from docchat.domain.chat_models import Chat, ChatSummary, Citation, Message, SourceSnapshot
from docchat.domain.enums import (
    ChatScope,
    Effort,
    Lane,
    MessageRole,
    MessageStatus,
    SourcesMode,
    TitleSource,
)
from docchat.domain.errors import ErrorCode, NoticeCode
from docchat.domain.models import Notice
from docchat.domain.ports import DuplicateMessage
from docchat.domain.usage import TokenUsage

_MESSAGE_COLUMNS = (
    "id, chat_id, role, parent_id, client_message_id, content, status, error_code, model,"
    " effort, lane, comparison_id, is_preferred, sources, sources_mode, citations, notices,"
    " usage, cost_usd, ttft_ms, total_ms, created_at"
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _message_values(m: Message) -> tuple[object, ...]:
    return (
        m.id,
        m.chat_id,
        m.role.value,
        m.parent_id,
        m.client_message_id,
        m.content,
        m.status.value,
        m.error_code.value if m.error_code else None,
        m.model,
        m.effort.value if m.effort else None,
        m.lane.value if m.lane else None,
        m.comparison_id,
        int(m.is_preferred),
        _json([asdict(s) for s in m.sources]),
        m.sources_mode.value if m.sources_mode else None,
        _json([asdict(c) for c in m.citations]),
        _json([{"code": n.code.value, "params": dict(n.params)} for n in m.notices]),
        _json(asdict(m.usage)) if m.usage else None,
        m.cost_usd,
        m.ttft_ms,
        m.total_ms,
        to_db(m.created_at),
    )


def _row_to_message(row: sqlite3.Row) -> Message:
    created = from_db(row["created_at"])
    assert created is not None
    return Message(
        id=row["id"],
        chat_id=row["chat_id"],
        role=MessageRole(row["role"]),
        created_at=created,
        content=row["content"],
        status=MessageStatus(row["status"]),
        parent_id=row["parent_id"],
        client_message_id=row["client_message_id"],
        error_code=ErrorCode(row["error_code"]) if row["error_code"] else None,
        model=row["model"],
        effort=Effort(row["effort"]) if row["effort"] else None,
        lane=Lane(row["lane"]) if row["lane"] else None,
        comparison_id=row["comparison_id"],
        is_preferred=bool(row["is_preferred"]),
        sources=tuple(SourceSnapshot(**s) for s in json.loads(row["sources"])),
        sources_mode=SourcesMode(row["sources_mode"]) if row["sources_mode"] else None,
        citations=tuple(Citation(**c) for c in json.loads(row["citations"])),
        notices=tuple(
            Notice(NoticeCode(n["code"]), n.get("params", {})) for n in json.loads(row["notices"])
        ),
        usage=TokenUsage(**json.loads(row["usage"])) if row["usage"] else None,
        cost_usd=row["cost_usd"],
        ttft_ms=row["ttft_ms"],
        total_ms=row["total_ms"],
    )


class SqliteChatRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    # Chats

    def _chat(self, conn: sqlite3.Connection, row: sqlite3.Row) -> Chat:
        document_ids = tuple(
            r[0]
            for r in conn.execute(
                "SELECT document_id FROM chat_documents WHERE chat_id = ? ORDER BY rowid",
                (row["id"],),
            )
        )
        created, updated = from_db(row["created_at"]), from_db(row["updated_at"])
        assert created is not None and updated is not None
        return Chat(
            id=row["id"],
            scope=ChatScope(row["scope"]),
            created_at=created,
            updated_at=updated,
            title=row["title"],
            title_source=TitleSource(row["title_source"]),
            document_ids=document_ids,
        )

    @staticmethod
    def _write_selection(conn: sqlite3.Connection, chat: Chat) -> None:
        conn.execute("DELETE FROM chat_documents WHERE chat_id = ?", (chat.id,))
        conn.executemany(
            "INSERT INTO chat_documents (chat_id, document_id) VALUES (?, ?)",
            [(chat.id, d) for d in chat.document_ids],
        )

    def insert_chat(self, chat: Chat) -> None:
        with self._db.connect() as conn:
            conn.execute("BEGIN")
            conn.execute(
                "INSERT INTO chats (id, title, title_source, scope, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    chat.id,
                    chat.title,
                    chat.title_source.value,
                    chat.scope.value,
                    to_db(chat.created_at),
                    to_db(chat.updated_at),
                ),
            )
            self._write_selection(conn, chat)
            conn.execute("COMMIT")

    def get_chat(self, chat_id: str) -> Chat | None:
        with self._db.connect() as conn:
            row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
            return self._chat(conn, row) if row else None

    def list_chats(self) -> list[ChatSummary]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT chats.*, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = chats.id)"
                " AS message_count FROM chats ORDER BY updated_at DESC, id"
            ).fetchall()
            return [ChatSummary(self._chat(conn, r), r["message_count"]) for r in rows]

    def count_chats(self) -> int:
        with self._db.connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM chats").fetchone()[0])

    def update_chat(self, chat: Chat) -> bool:
        with self._db.connect() as conn:
            conn.execute("BEGIN")
            changed = conn.execute(
                "UPDATE chats SET title = ?, title_source = ?, scope = ?, updated_at = ?"
                " WHERE id = ?",
                (
                    chat.title,
                    chat.title_source.value,
                    chat.scope.value,
                    to_db(chat.updated_at),
                    chat.id,
                ),
            ).rowcount
            if changed:
                self._write_selection(conn, chat)
            conn.execute("COMMIT")
            return changed == 1

    def delete_chat(self, chat_id: str) -> bool:
        with self._db.connect() as conn:
            return conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,)).rowcount == 1

    # Messages

    def insert_message(self, message: Message) -> None:
        placeholders = ", ".join("?" * len(_MESSAGE_COLUMNS.split(",")))
        try:
            with self._db.connect() as conn:
                conn.execute(
                    f"INSERT INTO messages ({_MESSAGE_COLUMNS}) VALUES ({placeholders})",
                    _message_values(message),
                )
        except sqlite3.IntegrityError as exc:
            if "ux_messages_client" in str(exc) or "client_message_id" in str(exc):
                raise DuplicateMessage(message.client_message_id) from exc
            raise

    def get_message(self, message_id: str) -> Message | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE id = ?", (message_id,)
            ).fetchone()
        return _row_to_message(row) if row else None

    def find_user_message(self, chat_id: str, client_message_id: str) -> Message | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages"
                " WHERE chat_id = ? AND client_message_id = ?",
                (chat_id, client_message_id),
            ).fetchone()
        return _row_to_message(row) if row else None

    def list_messages(self, chat_id: str) -> list[Message]:
        with self._db.connect() as conn:
            rows = conn.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE chat_id = ?"
                " ORDER BY created_at, rowid",
                (chat_id,),
            ).fetchall()
        return [_row_to_message(r) for r in rows]

    def count_messages(self, chat_id: str) -> int:
        with self._db.connect() as conn:
            return int(
                conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE chat_id = ?", (chat_id,)
                ).fetchone()[0]
            )

    def answer_in_lane(self, parent_id: str, lane: Lane) -> Message | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE parent_id = ? AND lane = ?",
                (parent_id, lane.value),
            ).fetchone()
        return _row_to_message(row) if row else None

    def save_message(self, message: Message) -> bool:
        columns = [c.strip() for c in _MESSAGE_COLUMNS.split(",")]
        mutable = [c for c in columns if c not in {"id", "chat_id", "role", "created_at"}]
        values = dict(zip(columns, _message_values(message), strict=True))
        assignments = ", ".join(f"{c} = ?" for c in mutable)
        with self._db.connect() as conn:
            return (
                conn.execute(
                    f"UPDATE messages SET {assignments} WHERE id = ?",
                    [*(values[c] for c in mutable), message.id],
                ).rowcount
                == 1
            )

    def interrupt_streaming(self) -> int:
        with self._db.connect() as conn:
            return int(
                conn.execute(
                    "UPDATE messages SET status = ? WHERE status = ?",
                    (MessageStatus.INTERRUPTED.value, MessageStatus.STREAMING.value),
                ).rowcount
            )
