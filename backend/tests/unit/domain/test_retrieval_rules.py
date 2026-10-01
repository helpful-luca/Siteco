from docchat.domain.models import Chunk
from docchat.domain.retrieval import (
    fits_full_context,
    follow_up_query,
    is_summary_request,
    select_sources,
    snippet,
)


def chunk(n: int, doc: str = "d1", text: str | None = None) -> Chunk:
    body = text or f"Text {n}"
    return Chunk(f"k{n}", doc, n, 1, "", body, body, ())


def test_follow_up_searches_with_the_previous_question() -> None:
    assert follow_up_query(None, "Und die Leistung?") == "Und die Leistung?"
    assert (
        follow_up_query("Welche Schutzart hat die Mira?", "Und die Leistung?")
        == "Welche Schutzart hat die Mira?\nUnd die Leistung?"
    )


def test_select_keeps_rank_order_and_top_k() -> None:
    ranked = [chunk(i) for i in range(20)]
    chosen = select_sources(ranked, top_k=8, per_document_cap=5, multiple_documents=False)
    assert [c.chunk_id for c in chosen] == [f"k{i}" for i in range(8)]


def test_one_document_may_take_at_most_the_cap_when_several_are_in_scope() -> None:
    ranked = [chunk(i, "big") for i in range(10)] + [chunk(10 + i, "small") for i in range(3)]
    chosen = select_sources(ranked, top_k=8, per_document_cap=5, multiple_documents=True)
    assert [c.document_id for c in chosen].count("big") == 5
    assert [c.document_id for c in chosen].count("small") == 3


def test_duplicate_texts_are_skipped() -> None:
    ranked = [chunk(1, "a", "Kopfzeile  Siteco"), chunk(2, "b", "kopfzeile siteco"), chunk(3)]
    chosen = select_sources(ranked, top_k=8, per_document_cap=5, multiple_documents=True)
    assert [c.chunk_id for c in chosen] == ["k1", "k3"]


def test_full_context_budget() -> None:
    # Conservative: two and a half characters per token (German compounds, catalog tables).
    assert fits_full_context([25_000, 25_000], 20_000)
    assert not fits_full_context([25_000, 25_003], 20_000)
    assert not fits_full_context([10], 0)


def test_summary_requests_are_recognized_in_german_and_english() -> None:
    assert is_summary_request("Fasse das Dokument zusammen")
    assert is_summary_request("Gib mir einen Überblick über den Katalog")
    assert is_summary_request("Summarize the datasheet")
    assert not is_summary_request("Welche Schutzart hat die Mira?")


def test_snippet_is_one_line_and_short() -> None:
    assert snippet("a\n b") == "a b"
    long = snippet("wort " * 100)
    assert len(long) <= 240 and long.endswith("…")


def test_full_context_limit_respects_the_model_window() -> None:
    from docchat.domain.context_budget import conservative_tokens, full_context_limit

    haiku = full_context_limit(
        configured=500_000, model="claude-haiku-4-5", max_output_tokens=4096, history_margin=8000
    )
    assert haiku == 200_000 - 4096 - 8000
    sonnet = full_context_limit(
        configured=150_000, model="claude-sonnet-5-5", max_output_tokens=4096, history_margin=8000
    )
    assert sonnet == 150_000
    assert conservative_tokens(1000) == 400
