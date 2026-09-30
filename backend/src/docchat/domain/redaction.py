"""Deleting a document removes its text from the answers that cited it (master spec 10b, 4).

File name, page and the position of each chip stay, so the answer still shows where a
source was; the cited sentence and the snippet are gone."""

from collections.abc import Collection
from dataclasses import replace

from docchat.domain.chat_models import Message


def _source_ids(message: Message, document_ids: Collection[str]) -> set[str]:
    return {s.id for s in message.sources if s.document_id in document_ids}


def mentions_text_of(message: Message, document_ids: Collection[str]) -> bool:
    """Whether the message still holds cited text of one of these documents."""
    ids = _source_ids(message, document_ids)
    return any(s.snippet for s in message.sources if s.id in ids) or any(
        c.cited_text for c in message.citations if c.source_id in ids
    )


def without_text_of(message: Message, document_ids: Collection[str]) -> Message:
    ids = _source_ids(message, document_ids)
    if not ids:
        return message
    return replace(
        message,
        sources=tuple(replace(s, snippet="") if s.id in ids else s for s in message.sources),
        citations=tuple(
            replace(c, cited_text="") if c.source_id in ids else c for c in message.citations
        ),
    )
