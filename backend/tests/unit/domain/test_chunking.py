import itertools

from docchat.domain.chunking import (
    TARGET_TOKENS,
    chunk_section,
    context_header,
    estimate_tokens,
    section_from_text,
)
from docchat.domain.models import Chunk
from docchat.domain.parsing import SentenceSpan, TextSection
from docchat.domain.sentences import split_sentences


def _chunk(section: TextSection, first_ordinal: int = 0) -> list[Chunk]:
    counter = itertools.count()
    return chunk_section(
        section,
        document_id="doc-1",
        document_name="Datenblatt.pdf",
        first_ordinal=first_ordinal,
        new_id=lambda: f"c{next(counter)}",
    )


def test_context_header_names_document_page_and_heading() -> None:
    assert context_header("A.pdf", 3, "Technik") == "Dokument: A.pdf / Seite 3 / Abschnitt: Technik"
    assert context_header("B.md", None, "") == "Dokument: B.md"


def test_small_page_becomes_one_chunk_with_all_sentences() -> None:
    section = section_from_text("Die Leuchte ist hell. Sie hat IP66.", page=2)
    [chunk] = _chunk(section, first_ordinal=7)
    assert chunk.ordinal == 7
    assert chunk.page == 2
    assert chunk.document_id == "doc-1"
    assert chunk.text == "Die Leuchte ist hell. Sie hat IP66."
    header = "Dokument: Datenblatt.pdf / Seite 2"
    assert chunk.search_text == f"{header}\nDie Leuchte ist hell. Sie hat IP66."
    assert [s.text for s in chunk.sentences] == ["Die Leuchte ist hell.", "Sie hat IP66."]
    assert [(s.i, s.char_start, s.char_end) for s in chunk.sentences] == [(0, 0, 21), (1, 22, 35)]


def test_long_text_is_packed_near_the_target_size_without_splitting_sentences() -> None:
    sentence = "Die Strassenleuchte erreicht eine hohe Lichtausbeute bei geringem Verbrauch."
    text = " ".join([sentence] * 120)
    chunks = _chunk(section_from_text(text, page=1))
    assert len(chunks) > 1
    for chunk in chunks:
        assert estimate_tokens(chunk.text) <= TARGET_TOKENS
        assert estimate_tokens(chunk.text) > TARGET_TOKENS * 0.8 or chunk is chunks[-1]
        assert all(s.text == sentence for s in chunk.sentences)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))
    assert sum(len(c.sentences) for c in chunks) == 120


def test_paragraph_break_ends_a_chunk_that_is_big_enough() -> None:
    first = " ".join(["Erster Absatz mit genug Text fuer einen Chunk."] * 30)
    text = first + "\n\nZweiter Absatz beginnt hier."
    chunks = _chunk(section_from_text(text, page=1))
    assert chunks[-1].text == "Zweiter Absatz beginnt hier."


def test_sentence_offsets_include_the_section_offset_and_keep_rects() -> None:
    rect = (0.1, 0.2, 0.3, 0.02)
    section = TextSection(
        text="Satz eins. Satz zwei.",
        sentences=(SentenceSpan(0, 10, (rect,)), SentenceSpan(11, 21, ())),
        heading="Einleitung",
        offset=100,
        precise_highlight=False,
    )
    [chunk] = _chunk(section)
    assert chunk.page is None
    assert chunk.heading == "Einleitung"
    assert chunk.precise_highlight is False
    assert chunk.sentences[0].rects == (rect,)
    assert (chunk.sentences[1].char_start, chunk.sentences[1].char_end) == (111, 121)
    assert chunk.search_text.startswith("Dokument: Datenblatt.pdf / Abschnitt: Einleitung\n")


def test_section_without_sentences_gives_no_chunks() -> None:
    assert _chunk(section_from_text("   ", page=1)) == []


def test_every_chunk_gets_a_fresh_id() -> None:
    text = " ".join(["Ein Satz mit etwas Inhalt fuer den Test."] * 200)
    chunks = _chunk(section_from_text(text, page=1))
    assert len({c.chunk_id for c in chunks}) == len(chunks)


def test_section_from_text_uses_the_sentence_splitter() -> None:
    text = "Eins. Zwei."
    section = section_from_text(text, page=4, heading="H", offset=5)
    assert [(s.start, s.end) for s in section.sentences] == split_sentences(text)
    assert (section.page, section.heading, section.offset) == (4, "H", 5)
