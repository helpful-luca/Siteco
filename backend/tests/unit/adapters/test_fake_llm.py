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
