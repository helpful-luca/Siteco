import json
import re
from datetime import UTC, datetime

from docchat.domain.chat_models import Chat, Citation, Message, SourceSnapshot
from docchat.domain.enums import ChatScope, Locale, MessageRole, MessageStatus
from docchat.domain.export_format import chat_markdown, chat_record, entry_stem

NOW = datetime(2026, 9, 30, 14, 5, tzinfo=UTC)
SAFE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _chat(title: str | None = "Welche Schutzart hat die Mira?") -> Chat:
    return Chat(id="c1", scope=ChatScope.ALL, created_at=NOW, updated_at=NOW, title=title)


def _messages() -> list[Message]:
    question = Message(
        id="u1", chat_id="c1", role=MessageRole.USER, created_at=NOW, content="Schutzart?"
    )
    answer = Message(
        id="a1",
        chat_id="c1",
        role=MessageRole.ASSISTANT,
        created_at=NOW,
        parent_id="u1",
        content="Die Mira hat IP66.",
        status=MessageStatus.COMPLETE,
        model="claude-sonnet-5-5",
        sources=(SourceSnapshot("s1", 1, "d1", "mira.pdf", 2, "Die Mira hat IP66."),),
        citations=(Citation("s1", 0, 1, "Die Mira hat IP66.", 18),),
        cost_usd=0.0012,
    )
    return [question, answer]


def test_entry_stems_are_safe_numbered_and_short() -> None:
    assert entry_stem(1, "Welche Schutzart hat die Mira?") == "001-welche-schutzart-hat-die-mira"
    assert entry_stem(2, "Größe/Maße ../../etc") == "002-grosse-masse-etc"
    assert entry_stem(3, None) == "003-chat"
    assert entry_stem(4, "   ") == "004-chat"
    assert entry_stem(5, "日本語") == "005-chat"
    long = entry_stem(6, "a" * 300)
    assert len(long) <= 64
    for stem in (long, entry_stem(7, "CON"), entry_stem(8, "x\u0000y")):
        assert SAFE.match(stem), stem


def test_chat_record_is_plain_json_with_sources_and_citations() -> None:
    record = chat_record(_chat(), _messages())
    text = json.dumps(record)
    assert record["chat"]["title"] == "Welche Schutzart hat die Mira?"
    assert record["chat"]["created_at"] == "2026-09-30T14:05:00+00:00"
    [question, answer] = record["messages"]
    assert question["role"] == "user"
    assert answer["sources"][0]["filename"] == "mira.pdf"
    assert answer["citations"][0]["cited_text"] == "Die Mira hat IP66."
    assert "IP66" in text


def test_markdown_reads_like_the_conversation() -> None:
    md = chat_markdown(_chat(), _messages(), Locale.DE)
    assert md.startswith("# Welche Schutzart hat die Mira?\n")
    assert "Schutzart?" in md
    assert "Die Mira hat IP66." in md
    assert "mira.pdf, Seite 2" in md
    english = chat_markdown(_chat(None), _messages(), Locale.EN)
    assert english.startswith("# New chat\n")
    assert "mira.pdf, page 2" in english
