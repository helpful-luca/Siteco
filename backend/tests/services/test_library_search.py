"""The MCP tools' service: ready documents only, limits, same retrieval as the chat."""

from pathlib import Path

import pytest

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.library_search import MAX_QUERY_CHARS, MAX_TOP_K, LibrarySearch
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from tests.fakes import FakeEmbedder
from tests.services.chat_support import ChatHarness, build_chat_harness


@pytest.fixture
def h(tmp_path: Path) -> ChatHarness:
    return build_chat_harness(tmp_path)


@pytest.fixture
def library(h: ChatHarness) -> LibrarySearch:
    retrieval = RetrievalService(h.documents, h.vectors, FakeEmbedder(dim=4), RetrievalSettings())
    return LibrarySearch(h.documents, retrieval)


def test_lists_only_ready_documents(h: ChatHarness, library: LibrarySearch) -> None:
    ready = h.add_document(("Seite eins.", "Seite zwei."), filename="a.pdf")
    h.add_document(status=DocumentStatus.EMBEDDING, filename="processing.pdf")
    h.add_document(status=DocumentStatus.FAILED, filename="failed.pdf")
    listed = library.list_documents()
    assert [(d.id, d.filename, d.kind, d.pages) for d in listed] == [
        (ready.id, "a.pdf", DocumentKind.PDF, 2)
    ]


async def test_search_returns_passages_with_source(h: ChatHarness, library: LibrarySearch) -> None:
    doc = h.add_document(("Die Mira hat Schutzart IP66.", "Gewicht 3 kg."), filename="Mira.pdf")
    passages = await library.search("Schutzart IP66")
    assert passages[0].filename == "Mira.pdf"
    assert passages[0].document_id == doc.id
    assert passages[0].page == 1
    assert "IP66" in passages[0].text
    assert passages[0].source_id in {c.chunk_id for c in h.chunks(doc)}


async def test_search_uses_the_chat_retrieval(h: ChatHarness, library: LibrarySearch) -> None:
    h.add_document(("Die Mira hat Schutzart IP66.",))
    await library.search("Schutzart", top_k=3)
    text, _, limit = h.vectors.searches[-1]
    assert text == "Schutzart"
    assert limit == RetrievalSettings().candidates  # the same candidate pool as the chat


async def test_search_never_exposes_unready_or_deleted(
    h: ChatHarness, library: LibrarySearch
) -> None:
    ready = h.add_document(("Schutzart IP66 der Mira.",), filename="ready.pdf")
    processing = h.add_document(
        ("Schutzart IP66 geheim.",), status=DocumentStatus.EMBEDDING, filename="p.pdf"
    )
    gone = h.add_document(("Schutzart IP66 gelöscht.",), filename="gone.pdf")
    h.documents.mark_deleting(gone.id, h.clock.now())  # still in the index until purged
    passages = await library.search(
        "Schutzart IP66", document_ids=[ready.id, processing.id, gone.id]
    )
    assert {p.filename for p in passages} == {"ready.pdf"}
    assert {p.filename for p in await library.search("Schutzart IP66")} == {"ready.pdf"}


async def test_document_ids_narrow_the_search(h: ChatHarness, library: LibrarySearch) -> None:
    h.add_document(("Schutzart IP66.",), filename="a.pdf")
    b = h.add_document(("Schutzart IP20.",), filename="b.pdf")
    passages = await library.search("Schutzart", document_ids=[b.id, "unknown"])
    assert {p.filename for p in passages} == {"b.pdf"}
    assert await library.search("Schutzart", document_ids=[]) == []


async def test_top_k_is_clamped(h: ChatHarness, library: LibrarySearch) -> None:
    h.add_document(tuple(f"Schutzart Absatz {i} Leuchte." for i in range(15)))
    assert len(await library.search("Schutzart Leuchte", top_k=100)) == MAX_TOP_K
    assert len(await library.search("Schutzart Leuchte", top_k=0)) == 1
    assert len(await library.search("Schutzart Leuchte")) == 5


@pytest.mark.parametrize("query", ["", "   ", "x" * (MAX_QUERY_CHARS + 1)])
async def test_query_limits(library: LibrarySearch, query: str) -> None:
    with pytest.raises(AppError) as error:
        await library.search(query)
    assert error.value.code is ErrorCode.VALIDATION_ERROR


async def test_too_many_document_ids(library: LibrarySearch) -> None:
    with pytest.raises(AppError):
        await library.search("q", document_ids=[str(i) for i in range(51)])


async def test_chat_attachments_are_invisible_to_mcp(
    h: ChatHarness, library: LibrarySearch
) -> None:
    chat = h.new_chat()
    h.add_document(("Die Mira hat Schutzart IP66.",), filename="Bibliothek.pdf")
    h.add_document(("Die Mira hat Schutzart IP66.",), filename="Anhang.pdf", attach_to=chat.id)
    assert [d.filename for d in library.list_documents()] == ["Bibliothek.pdf"]
    assert {p.filename for p in await library.search("Schutzart IP66")} == {"Bibliothek.pdf"}
