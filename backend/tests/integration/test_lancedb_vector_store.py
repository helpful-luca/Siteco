from pathlib import Path
from uuid import uuid4

import pytest

from docchat.adapters.lancedb_vector_store import LanceVectorStore
from docchat.domain.models import Chunk, Sentence

DIM = 8


def _chunk(document_id: str, ordinal: int, text: str = "Die Leuchte hat IP66.") -> Chunk:
    return Chunk(
        chunk_id=str(uuid4()),
        document_id=document_id,
        ordinal=ordinal,
        page=ordinal + 1,
        heading="",
        text=text,
        search_text=f"Dokument: a.pdf\n{text}",
        sentences=(Sentence(0, text, 0, len(text), ((0.1, 0.1, 0.5, 0.02),)),),
        precise_highlight=True,
    )


@pytest.fixture
def store(tmp_path: Path) -> LanceVectorStore:
    s = LanceVectorStore(tmp_path / "lancedb", fts_language="German")
    s.open(DIM)
    return s


def test_add_and_read_back_one_chunk(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    chunks = [_chunk(doc, 0), _chunk(doc, 1)]
    store.add(chunks, [[0.1] * DIM, [0.2] * DIM])
    assert store.count(doc) == 2
    assert store.get_chunk(doc, chunks[1].chunk_id) == chunks[1]
    assert store.get_chunk(doc, str(uuid4())) is None
    assert store.get_chunk(str(uuid4()), chunks[1].chunk_id) is None
    assert store.ping()


def test_delete_document_and_sweep(store: LanceVectorStore) -> None:
    keep, gone, orphan = str(uuid4()), str(uuid4()), str(uuid4())
    for doc in (keep, gone, orphan):
        store.add([_chunk(doc, 0)], [[0.3] * DIM])
    store.delete_document(gone)
    store.delete_documents_except({keep})
    store.optimize()
    assert store.document_ids() == {keep}


def test_filters_only_accept_canonical_uuids(store: LanceVectorStore) -> None:
    with pytest.raises(ValueError):
        store.delete_document("x' OR '1' = '1")
    with pytest.raises(ValueError):
        store.get_chunk(str(uuid4()).upper(), str(uuid4()))


def test_german_full_text_search_after_optimize(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    store.add([_chunk(doc, 0, "Die Straßenleuchten haben IP66.")], [[0.1] * DIM])
    store.optimize()
    table = store._require()
    hits = table.search("strassenleuchte", query_type="fts").limit(3).to_list()
    assert [h["document_id"] for h in hits] == [doc]


def test_reopen_keeps_data_and_rejects_another_dimension(tmp_path: Path) -> None:
    first = LanceVectorStore(tmp_path / "lancedb", fts_language="German")
    first.open(DIM)
    doc = str(uuid4())
    first.add([_chunk(doc, 0)], [[0.1] * DIM])
    again = LanceVectorStore(tmp_path / "lancedb", fts_language="German")
    again.open(DIM)
    assert again.count(doc) == 1
    with pytest.raises(RuntimeError):
        LanceVectorStore(tmp_path / "lancedb", fts_language="German").open(DIM * 2)


def test_add_requires_one_vector_per_chunk(store: LanceVectorStore) -> None:
    with pytest.raises(ValueError):
        store.add([_chunk(str(uuid4()), 0)], [])
    store.add([], [])


def test_hybrid_search_finds_exact_codes_within_the_given_documents(
    store: LanceVectorStore,
) -> None:
    mira, luna, other = str(uuid4()), str(uuid4()), str(uuid4())
    store.add(
        [
            _chunk(mira, 0, "Die Mira hat die Schutzart IP66."),
            _chunk(mira, 1, "Die Mira leistet 40 W."),
            _chunk(luna, 0, "Straßenleuchten der Serie Luna sind robust."),
            _chunk(other, 0, "Schutzart IP66 auch hier, aber außerhalb des Scopes."),
        ],
        [[0.1] * DIM, [0.9] * DIM, [0.5] * DIM, [0.1] * DIM],
    )
    hits = store.search("Welche Schutzart, IP66?", [0.1] * DIM, [mira, luna], limit=20)
    assert hits[0].text == "Die Mira hat die Schutzart IP66."
    assert {h.document_id for h in hits} <= {mira, luna}
    assert len(hits) == 3  # prefiltered: the limit is filled from the scope only
    assert store.search("egal", [0.1] * DIM, [], limit=5) == []


def test_german_stemming_and_folding_in_the_text_search(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    store.add([_chunk(doc, 0, "Straßenleuchten für Wohngebiete.")], [[0.5] * DIM])
    hits = store.search("strassenleuchte", [0.0] * DIM, [doc], limit=1)
    assert hits and "Straßenleuchten" in hits[0].text


def test_chunks_of_returns_all_chunks_in_document_order(store: LanceVectorStore) -> None:
    first, second = str(uuid4()), str(uuid4())
    store.add(
        [_chunk(second, 1), _chunk(first, 1), _chunk(second, 0), _chunk(first, 0)],
        [[0.1] * DIM] * 4,
    )
    ordered = store.chunks_of([first, second])
    assert [(c.document_id, c.ordinal) for c in ordered] == [
        (first, 0), (first, 1), (second, 0), (second, 1)
    ]  # fmt: skip
    assert store.chunks_of([]) == []


def test_search_filters_only_accept_canonical_uuids(store: LanceVectorStore) -> None:
    with pytest.raises(ValueError):
        store.search("x", [0.1] * DIM, ["x') OR ('1' = '1"], limit=5)


def _files_with(root: Path, needle: bytes) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file() and needle in p.read_bytes()]


def test_purge_removes_deleted_text_from_disk_at_once(
    tmp_path: Path, store: LanceVectorStore
) -> None:
    keep, gone = str(uuid4()), str(uuid4())
    for doc, text in (
        (keep, "Die Leuchte hat IP66."),
        (gone, "Kennung QX-PURGE-4411 bleibt nicht."),
    ):
        chunks = [_chunk(doc, i, text) for i in range(3)]
        store.add(chunks, [[0.1] * DIM] * 3)
        store.optimize()
    store.delete_document(gone)
    store.optimize()  # normal path: old versions stay for a few minutes
    assert _files_with(tmp_path / "lancedb", b"QX-PURGE-4411")

    store.purge_deleted()
    assert _files_with(tmp_path / "lancedb", b"QX-PURGE-4411") == []
    assert store.count(keep) == 3
    assert store.search("IP66", [0.1] * DIM, [keep], 5)


def test_search_modes_dense_bm25_and_hybrid(store: LanceVectorStore) -> None:
    """The eval compares the three retrievers on the same index (annex 11, 5.3)."""
    from docchat.domain.enums import SearchMode

    doc = str(uuid4())
    exact = _chunk(doc, 0, "Die Viaro hat die Schutzart IP66 und IK10.")
    similar = _chunk(doc, 1, "Ein Gehäuse aus Aluminium mit grauer Pulverbeschichtung.")
    store.add([exact, similar], [[1.0] + [0.0] * (DIM - 1), [0.0] * (DIM - 1) + [1.0]])
    near_similar = [0.0] * (DIM - 1) + [1.0]

    dense = store.search("IP66", near_similar, [doc], 2, mode=SearchMode.DENSE)
    assert [c.chunk_id for c in dense] == [similar.chunk_id, exact.chunk_id]
    bm25 = store.search("IP66", near_similar, [doc], 2, mode=SearchMode.BM25)
    assert [c.chunk_id for c in bm25] == [exact.chunk_id]  # only text matches
    hybrid = store.search("IP66", near_similar, [doc], 2, mode=SearchMode.HYBRID)
    assert {c.chunk_id for c in hybrid} == {exact.chunk_id, similar.chunk_id}


def test_text_index_can_be_rebuilt_with_another_stemmer(store: LanceVectorStore) -> None:
    from docchat.domain.enums import SearchMode

    doc = str(uuid4())
    chunk = _chunk(doc, 0, "Die Leuchten sind für Straßen geeignet.")
    store.add([chunk], [[0.5] * DIM])
    vector = [0.5] * DIM
    assert store.search("Leuchte", vector, [doc], 1, mode=SearchMode.BM25)  # German stem
    store.rebuild_text_index(None)  # no stemming: the plural no longer matches the singular
    assert not store.search("Leuchte", vector, [doc], 1, mode=SearchMode.BM25)
    assert store.search("leuchten", vector, [doc], 1, mode=SearchMode.BM25)


def test_pages_come_back_in_reading_order(store: LanceVectorStore) -> None:
    doc, other = str(uuid4()), str(uuid4())
    first, second, third = (_chunk(doc, o) for o in (0, 1, 2))  # pages 1, 2, 3
    twin = Chunk(**{**second.__dict__, "chunk_id": str(uuid4()), "ordinal": 5})  # page 2 again
    store.add([third, twin, first, second], [[0.1] * DIM] * 4)
    store.add([_chunk(other, 1)], [[0.1] * DIM])
    found = store.chunks_of_pages([doc], [2, 3])
    assert [c.chunk_id for c in found] == [second.chunk_id, twin.chunk_id, third.chunk_id]
    assert store.chunks_of_pages([doc], [99]) == []


def test_find_text_matches_inside_compounds_without_case(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    hit = _chunk(doc, 0, "Die Bemessungslebensdauer (L90B10) beträgt 50.000 h.")
    miss = _chunk(doc, 1, "Nichts davon.")
    store.add([hit, miss], [[0.1] * DIM] * 2)
    assert [c.chunk_id for c in store.find_text("lebensdauer", [doc], 10)] == [hit.chunk_id]
    assert [c.chunk_id for c in store.find_text("l90b10", [doc], 10)] == [hit.chunk_id]
    assert store.find_text("50.000", [doc], 10)[0].chunk_id == hit.chunk_id
    assert store.find_text("lebensdauer", [str(uuid4())], 10) == []


def test_find_text_refuses_anything_but_a_plain_term(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    with pytest.raises(ValueError):
        store.find_text("x' OR '1'='1", [doc], 10)
    with pytest.raises(ValueError):
        store.find_text("100%", [doc], 10)


def test_untrustworthy_rectangles_are_dropped_when_a_chunk_is_read(store: LanceVectorStore) -> None:
    doc = str(uuid4())
    text = "Tabellenzeile mit Werten."
    jumpy = tuple((0.1, y, 0.5, 0.012) for y in (0.5, 0.1, 0.7, 0.2, 0.8, 0.3))
    chunk = Chunk(
        chunk_id=str(uuid4()), document_id=doc, ordinal=0, page=1, heading="", text=text,
        search_text=text, sentences=(Sentence(0, text, 0, len(text), jumpy),),
    )  # fmt: skip
    store.add([chunk], [[0.1] * DIM])
    read = store.get_chunk(doc, chunk.chunk_id)
    assert read is not None and read.sentences[0].rects == ()
