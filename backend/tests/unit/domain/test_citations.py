from docchat.domain.citations import AnswerAssembler
from docchat.domain.llm import CitationDelta


def cite(source: str = "k1", start: int = 0, end: int = 1, text: str = "IP66.") -> CitationDelta:
    return CitationDelta(source, start, end, text)


def test_citation_is_placed_at_the_end_of_its_block() -> None:
    answer = AnswerAssembler({"k1"})
    answer.add_text("Die Mira hat ")
    assert answer.end_block() == []
    answer.add_text("die Schutzart IP66")
    answer.add_citation(cite())
    [placed] = answer.end_block()
    assert placed.char_offset == len("Die Mira hat die Schutzart IP66")
    assert answer.text[: placed.char_offset].endswith("IP66")


def test_offset_does_not_depend_on_whether_the_citation_comes_first() -> None:
    first, last = AnswerAssembler({"k1"}), AnswerAssembler({"k1"})
    first.add_citation(cite())
    first.add_text("IP66")
    last.add_text("IP66")
    last.add_citation(cite())
    assert first.end_block() == last.end_block()


def test_citations_inside_tables_and_lists_point_into_the_markdown() -> None:
    answer = AnswerAssembler({"k1", "k2"})
    blocks = [
        ("| Leuchte | Schutzart |\n|---|---|\n| Mira | ", None),
        ("IP66", cite("k1")),
        (" |\n| Luna | ", None),
        ("IP65", cite("k2", 2, 3, "IP65.")),
        (" |\n\n- Leistung: ", None),
        ("40 W", cite("k1", 1, 2, "40 W.")),
        ("\n", None),
    ]
    for text, citation in blocks:
        answer.add_text(text)
        if citation:
            answer.add_citation(citation)
        answer.end_block()
    text = answer.text
    anchors = [text[: c.char_offset] for c in answer.citations]
    assert anchors[0].endswith("| Mira | IP66")
    assert anchors[1].endswith("| Luna | IP65")
    assert anchors[2].endswith("- Leistung: 40 W")
    assert [c.source_id for c in answer.citations] == ["k1", "k2", "k1"]


def test_unknown_sources_and_broken_ranges_are_discarded() -> None:
    answer = AnswerAssembler({"k1"})
    answer.add_text("x")
    answer.add_citation(cite("other"))
    answer.add_citation(cite("k1", 2, 2))
    assert answer.end_block() == []
    assert answer.discarded == 2


def test_the_same_citation_twice_at_one_spot_is_one_chip() -> None:
    answer = AnswerAssembler({"k1"})
    answer.add_text("x")
    answer.add_citation(cite())
    answer.add_citation(cite())
    assert len(answer.end_block()) == 1
