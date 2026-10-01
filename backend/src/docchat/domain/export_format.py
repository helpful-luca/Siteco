"""What a workspace export looks like: chats as JSON and Markdown.

Pure functions; the service packs their output into a ZIP."""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import asdict
from datetime import datetime
from typing import Any

from docchat.domain.chat_models import Chat, Message
from docchat.domain.enums import Locale, MessageRole, MessageStatus
from docchat.domain.model_profiles import MODEL_PROFILES

_STEM_CHARS = 50
_NOT_SLUG = re.compile(r"[^a-z0-9]+")
_FINISHED = (MessageStatus.COMPLETE, MessageStatus.SOURCES_ONLY)

_LABELS = {
    Locale.DE: {
        "untitled": "Neuer Chat",
        "question": "Frage",
        "answer": "Antwort",
        "sources": "Quellen",
        "page": "Seite",
        "incomplete": "Diese Antwort ist unvollständig.",
    },
    Locale.EN: {
        "untitled": "New chat",
        "question": "Question",
        "answer": "Answer",
        "sources": "Sources",
        "page": "page",
        "incomplete": "This answer is incomplete.",
    },
}


def entry_stem(index: int, title: str | None) -> str:
    """`001-welche-schutzart`: ASCII only, no path parts, never empty, at most 54 characters."""
    text = unicodedata.normalize("NFKD", (title or "").replace("ß", "ss").replace("ẞ", "SS"))
    ascii_text = text.encode("ascii", "ignore").decode().lower()
    slug = _NOT_SLUG.sub("-", ascii_text).strip("-")[:_STEM_CHARS].rstrip("-")
    return f"{index:03d}-{slug or 'chat'}"


def _time(value: datetime) -> str:
    return value.isoformat()


def _message_record(m: Message) -> dict[str, Any]:
    return {
        "id": m.id,
        "role": m.role.value,
        "content": m.content,
        "status": m.status.value,
        "parent_id": m.parent_id,
        "model": m.model,
        "effort": m.effort.value if m.effort else None,
        "lane": m.lane.value if m.lane else None,
        "is_preferred": m.is_preferred,
        "error_code": m.error_code.value if m.error_code else None,
        "sources": [
            {
                "index": s.index,
                "document_id": s.document_id,
                "filename": s.filename,
                "page": s.page,
                "snippet": s.snippet,
            }
            for s in m.sources
        ],
        "citations": [
            {"source_id": c.source_id, "cited_text": c.cited_text, "char_offset": c.char_offset}
            for c in m.citations
        ],
        "usage": asdict(m.usage) if m.usage else None,
        "cost_usd": m.cost_usd,
        "created_at": _time(m.created_at),
    }


def chat_record(chat: Chat, messages: Sequence[Message]) -> dict[str, Any]:
    return {
        "chat": {
            "id": chat.id,
            "title": chat.title,
            "scope": chat.scope.value,
            "document_ids": list(chat.document_ids),
            "created_at": _time(chat.created_at),
            "updated_at": _time(chat.updated_at),
        },
        "messages": [_message_record(m) for m in messages],
    }


def _sources_markdown(m: Message, labels: dict[str, str]) -> list[str]:
    cited = {c.source_id for c in m.citations}
    sources = [s for s in m.sources if s.id in cited]
    if not sources:
        return []
    lines = [f"{labels['sources']}:", ""]
    for s in sorted(sources, key=lambda s: s.index):
        where = f", {labels['page']} {s.page}" if s.page is not None else ""
        lines.append(f"{s.index}. {s.filename}{where}")
    return [*lines, ""]


def chat_markdown(chat: Chat, messages: Sequence[Message], locale: Locale) -> str:
    labels = _LABELS[locale]
    lines = [f"# {chat.title or labels['untitled']}", ""]
    for m in messages:
        if m.role is MessageRole.USER:
            lines += [f"## {labels['question']}", "", m.content, ""]
            continue
        if not m.is_preferred:
            continue  # the comparison answer that was not kept
        profile = MODEL_PROFILES.get(m.model or "")
        model = f" ({profile.label if profile else m.model})" if m.model else ""
        lines += [f"## {labels['answer']}{model}", ""]
        if m.content:
            lines += [m.content, ""]
        if m.status not in _FINISHED:
            lines += [f"_{labels['incomplete']}_", ""]
        lines += _sources_markdown(m, labels)
    return "\n".join(lines).rstrip() + "\n"
