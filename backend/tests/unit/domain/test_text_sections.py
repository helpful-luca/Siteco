from docchat.domain.parsing import TextContent
from docchat.domain.text_sections import text_sections


def test_text_without_headings_is_one_section() -> None:
    [section] = text_sections(TextContent("Hallo Welt. Zweiter Satz."))
    assert section.heading == ""
    assert section.page is None
    assert section.offset == 0
    assert len(section.sentences) == 2


def test_headings_start_new_sections_and_stay_searchable() -> None:
    text = "Vorwort.\n# Technik\nIP66 und 5000 lm.\n## Montage\nMast oder Wand."
    headings = ((9, "Technik"), (37, "Montage"))
    sections = list(text_sections(TextContent(text, headings)))
    assert [s.heading for s in sections] == ["", "Technik", "Montage"]
    assert sections[1].text.startswith("# Technik")
    for section in sections:
        assert text[section.offset : section.offset + len(section.text)] == section.text


def test_long_sections_are_cut_into_blocks_at_paragraphs() -> None:
    paragraph = "Ein Absatz mit einem Satz. " * 20
    text = "\n\n".join([paragraph.strip()] * 50)
    sections = list(text_sections(TextContent(text), max_block_chars=2000))
    assert len(sections) > 1
    assert all(len(s.text) <= 2000 for s in sections)
    for section in sections:
        assert text[section.offset : section.offset + len(section.text)] == section.text
        assert section.text.startswith("Ein Absatz")
    assert sum(len(s.sentences) for s in sections) == 1000


def test_blank_sections_are_skipped() -> None:
    text = "# Leer\n\n\n# Voll\nInhalt."
    sections = list(text_sections(TextContent(text, ((0, "Leer"), (9, "Voll")))))
    assert [s.heading for s in sections] == ["Leer", "Voll"]
    assert list(text_sections(TextContent("   \n  "))) == []
