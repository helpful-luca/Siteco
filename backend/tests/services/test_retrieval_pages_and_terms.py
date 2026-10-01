"""Page questions and exact term recall in retrieval mode (full-context turned off)."""

from pathlib import Path

import pytest

from docchat.domain.enums import SourcesMode
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from tests.fakes import FakeEmbedder
from tests.services.chat_support import ChatHarness, build_chat_harness

PAGES = [
    f"Seite Fülltext {n} mit Beschreibung der Leuchtenfamilie Modell{n}." for n in range(1, 31)
]


@pytest.fixture
def h(tmp_path: Path) -> ChatHarness:
    return build_chat_harness(tmp_path, full_context_max_tokens=0)


def _service(h: ChatHarness) -> RetrievalService:
    return RetrievalService(
        h.documents, h.vectors, FakeEmbedder(dim=4), RetrievalSettings(full_context_max_tokens=0)
    )


async def _retrieve(h: ChatHarness, question: str, query: str | None = None):  # type: ignore[no-untyped-def]
    service = _service(h)
    plan = service.plan(h.new_chat())
    assert plan.mode is SourcesMode.RETRIEVAL
    return await service.retrieve(plan, query or question, question)


async def test_a_page_question_returns_exactly_that_page(h: ChatHarness) -> None:
    pages = list(PAGES)
    pages[9] = "Zehnte Seite: Hier steht der Inhalt von Seite 56 nicht."
    document = h.add_document(pages)
    retrieved = await _retrieve(h, "Was steht auf Seite 10?")
    assert [c.page for c in retrieved.chunks] == [10]
    assert retrieved.requested_pages == (10,)
    assert retrieved.chunks[0].document_id == document.id


async def test_a_page_range_comes_in_reading_order(h: ChatHarness) -> None:
    h.add_document(PAGES)
    retrieved = await _retrieve(h, "Fasse Seiten 7 bis 9 zusammen")
    assert [c.page for c in retrieved.chunks] == [7, 8, 9]


async def test_the_named_document_wins_for_a_page_question(h: ChatHarness) -> None:
    h.add_document(PAGES, filename="Katalog.pdf")
    other = h.add_document(["Eins", "Zwei", "Drei"], filename="Handbuch.pdf")
    retrieved = await _retrieve(h, "Was steht im Handbuch auf Seite 2?")
    assert [(c.document_id, c.page) for c in retrieved.chunks] == [(other.id, 2)]
    both = await _retrieve(h, "Was steht auf Seite 2?")
    assert [c.page for c in both.chunks] == [2, 2]


async def test_a_page_that_does_not_exist_falls_back_to_the_search(h: ChatHarness) -> None:
    h.add_document(PAGES)
    retrieved = await _retrieve(h, "Was steht auf Seite 99?")
    assert retrieved.requested_pages == (99,)
    assert retrieved.chunks  # ranked passages instead of nothing


async def test_a_single_term_finds_its_passage_inside_a_compound(h: ChatHarness) -> None:
    pages = list(PAGES)
    pages[24] = "Die Bemessungslebensdauer beträgt 50.000 h bei L90B10."
    h.add_document(pages)
    for question in ("Lebensdauer", "bemessungslebensdauer", "L90B10"):
        retrieved = await _retrieve(h, question)
        assert retrieved.chunks[0].page == 25, question


async def test_a_code_in_a_long_question_is_not_lost(h: ChatHarness) -> None:
    pages = [f"Füllseite Leuchte Schutzart Modell Beschreibung {n}." for n in range(1, 41)]
    pages[19] = "Variante Q7: 59RC1D, IK08."
    h.add_document(pages)
    question = "Welche Schutzart Leuchte Beschreibung Modell hat die Artikelnummer 59RC1D?"
    retrieved = await _retrieve(h, question)
    assert 20 in [c.page for c in retrieved.chunks]


async def test_a_follow_up_keeps_the_context_of_the_search(h: ChatHarness) -> None:
    pages = list(PAGES)
    pages[3] = "Modell4 Lichtstrom 3000 lm."
    pages[8] = "Lichtstrom 9000 lm."
    h.add_document(pages)
    retrieved = await _retrieve(h, "Lichtstrom?", query="Modell4\nLichtstrom?")
    assert retrieved.chunks[0].page == 4


async def test_a_short_product_name_matches_as_a_phrase(h: ChatHarness) -> None:
    pages = [f"Spot {n} micro Leuchte Beschreibung." for n in range(1, 31)]
    pages[14] = "Der FL 31 micro Scheinwerfer."
    h.add_document(pages)
    retrieved = await _retrieve(h, "FL 31 micro")
    assert retrieved.chunks[0].page == 15
