from docchat.domain.exact_terms import (
    fuse,
    is_keyword_query,
    is_rare,
    missing_from,
    query_terms,
    rank_exact,
)
from tests.unit.domain.chunk_factory import make_chunk


def test_terms_drop_filler_words_and_keep_codes() -> None:
    assert query_terms("Welche Schutzart hat IP66 und IK08?") == ("schutzart", "ip66", "ik08")
    assert query_terms("Bemessungslebensdauer") == ("bemessungslebensdauer",)
    assert query_terms("L90B10, 4.000 K") == ("l90b10", "4.000")
    assert query_terms("Was steht auf Seite 56?") == ()
    assert query_terms("Artikel 59RC1D?") == ("artikel", "59rc1d")


def test_keyword_queries_are_short_and_rare_terms_are_codes_or_compounds() -> None:
    assert is_keyword_query("Bemessungslebensdauer", query_terms("Bemessungslebensdauer"))
    assert is_keyword_query("IP66 IK08", query_terms("IP66 IK08"))
    question = "Welche Lichtfarben gibt es bei der Mira Leuchte"
    assert not is_keyword_query(question, query_terms(question))
    assert is_rare("ip66") and is_rare("bemessungslebensdauer")
    assert not is_rare("leuchte")


def test_exact_matches_rank_by_density_and_cover_all_terms() -> None:
    dense = make_chunk("a", text="IP66 IP66 Schutzart")
    sparse = make_chunk("b", text="IP66 " + "Füllwort " * 80)
    both = make_chunk("c", text="Schutzart IP66 IK08")
    ranked = rank_exact([sparse, dense, both], ("ip66", "ik08"))
    assert ranked[0].chunk_id == "c"
    assert [c.chunk_id for c in ranked[1:]] == ["a", "b"]


def test_missing_terms_are_those_no_result_contains() -> None:
    chunks = [make_chunk("a", text="Bemessungslebensdauer 50.000 h")]
    assert missing_from(chunks, ("lebensdauer", "ip66")) == ("ip66",)


def test_weighted_fusion_puts_exact_hits_first_for_keyword_queries() -> None:
    hybrid = [make_chunk(c, text=c) for c in "xyz"]
    exact = [hybrid[2], make_chunk("e", text="e")]
    fused = fuse(hybrid, exact, exact_weight=3.0)
    assert [c.chunk_id for c in fused][:2] == ["z", "e"]
    assert {c.chunk_id for c in fused} == {"x", "y", "z", "e"}
    even = fuse(hybrid, exact, exact_weight=1.0)
    assert even[0].chunk_id == "z"
