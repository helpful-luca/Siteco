from docchat.adapters.fake_llm import FakeLLMClient
from docchat.domain.llm import CitationDelta, LLMRequest, SearchResult, TextDelta


def _request(*sentences: str) -> LLMRequest:
    return LLMRequest(
        model="claude-sonnet-5-5",
        effort=None,
        history=(),
        search_results=(SearchResult(source="c1", title="Mira.pdf", sentences=sentences),),
        question="Welche Schutzart?",
        ui_language="de",
        answer_style="concise",
        max_tokens=100,
    )


async def _events(request: LLMRequest) -> list[object]:
    return [event async for event in FakeLLMClient().stream(request)]


async def test_cites_the_first_real_sentence_not_a_heading() -> None:
    events = await _events(_request("Technische Daten", "Die Mira L hat die Schutzart IP66."))
    [citation] = [e for e in events if isinstance(e, CitationDelta)]
    assert (citation.block_start, citation.block_end) == (1, 2)
    assert "Schutzart IP66" in "".join(e.text for e in events if isinstance(e, TextDelta))


async def test_falls_back_to_the_first_sentence() -> None:
    events = await _events(_request("Kurz", "Auch kurz"))
    [citation] = [e for e in events if isinstance(e, CitationDelta)]
    assert (citation.block_start, citation.block_end) == (0, 1)


async def test_skips_long_markdown_headings_and_table_rows() -> None:
    events = await _events(
        _request(
            "## Technische Daten der Mira L Strassenleuchte",
            "| Schutzart | IP66 | Leistung | 40 W |",
            "Die Mira L hat die Schutzart IP66.",
        )
    )
    [citation] = [e for e in events if isinstance(e, CitationDelta)]
    assert (citation.block_start, citation.block_end) == (2, 3)


async def test_looks_into_the_next_result_when_the_first_has_no_sentence() -> None:
    request = LLMRequest(
        model="claude-sonnet-5-5",
        effort=None,
        history=(),
        search_results=(
            SearchResult(source="c1", title="a.md", sentences=("# Mira Datenblatt Version 2",)),
            SearchResult(source="c2", title="b.md", sentences=("Die Mira L hat IP66.",)),
        ),
        question="Welche Schutzart?",
        ui_language="de",
        answer_style="concise",
        max_tokens=100,
    )
    [citation] = [e for e in await _events(request) if isinstance(e, CitationDelta)]
    assert citation.source == "c2"


async def test_a_scenario_can_be_limited_to_one_model() -> None:
    """`#fake:<scenario>@<model>` fails one lane of a comparison and leaves the other alone."""
    from dataclasses import replace

    from docchat.domain.llm import LLMError

    question = "Welche Schutzart? #fake:overloaded@claude-haiku-4-5 #fake:no_citations"
    sonnet = replace(_request("Die Mira L hat die Schutzart IP66."), question=question)
    events = await _events(sonnet)  # the generic marker applies: no citation
    assert not [e for e in events if isinstance(e, CitationDelta)]
    haiku = replace(sonnet, model="claude-haiku-4-5")
    try:
        await _events(haiku)
    except LLMError as error:
        assert error.code == "LLM_OVERLOADED"
    else:
        raise AssertionError("the haiku lane should fail")
