from datetime import UTC, datetime

from docchat.domain.chat_models import Citation, Message, SourceSnapshot
from docchat.domain.enums import MessageRole
from docchat.domain.redaction import mentions_text_of, without_text_of

NOW = datetime(2026, 9, 30, tzinfo=UTC)


def _answer() -> Message:
    return Message(
        id="m1",
        chat_id="c1",
        role=MessageRole.ASSISTANT,
        created_at=NOW,
        content="Die Mira hat IP66.",
        sources=(
            SourceSnapshot("s1", 1, "gone", "mira.pdf", 2, "Die Mira hat IP66."),
            SourceSnapshot("s2", 2, "kept", "lux.pdf", 1, "Lux hat IP65."),
        ),
        citations=(
            Citation("s1", 0, 1, "Die Mira hat IP66.", 18),
            Citation("s2", 0, 1, "Lux hat IP65.", 18),
        ),
    )


def test_blanks_snippet_and_cited_text_of_the_given_documents_only() -> None:
    redacted = without_text_of(_answer(), {"gone"})
    assert [s.snippet for s in redacted.sources] == ["", "Lux hat IP65."]
    assert [c.cited_text for c in redacted.citations] == ["", "Lux hat IP65."]
    # Where and what stays: file name, page, positions of the chips
    assert redacted.sources[0].filename == "mira.pdf"
    assert redacted.citations[0].char_offset == 18
    assert redacted.content == "Die Mira hat IP66."


def test_knows_whether_a_message_still_holds_text_of_a_document() -> None:
    answer = _answer()
    assert mentions_text_of(answer, {"gone"})
    assert not mentions_text_of(without_text_of(answer, {"gone"}), {"gone"})
    assert not mentions_text_of(answer, {"other"})


def test_leaves_a_message_without_those_sources_untouched() -> None:
    answer = _answer()
    assert without_text_of(answer, {"other"}) is answer
