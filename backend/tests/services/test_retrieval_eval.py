"""The evaluator against fakes: ranks, sources, scope, follow-ups and the full-context view."""

from uuid import uuid4

from docchat.domain.enums import SearchMode
from docchat.domain.eval_set import EvalQuestion, QuestionCategory, RelevantPages
from docchat.domain.models import Chunk
from docchat.services.retrieval_eval import EvalCorpus, RetrievalEvaluator
from docchat.services.retrieval_service import RetrievalSettings
from tests.fakes import FakeEmbedder, FakeTicker, FakeVectorStore


def chunk(document_id: str, page: int, text: str) -> Chunk:
    return Chunk(str(uuid4()), document_id, page, page, "", text, text, (), True)


def question(text: str, relevant: dict[str, set[int]], **extra: object) -> EvalQuestion:
    pages = tuple(RelevantPages(d, frozenset(p)) for d, p in relevant.items())
    category = extra.pop("category", QuestionCategory.FACTUAL)
    return EvalQuestion("q", category, "de", text, pages, **extra)  # type: ignore[arg-type]


def setup() -> tuple[RetrievalEvaluator, FakeVectorStore, EvalCorpus]:
    vectors = FakeVectorStore()
    viaro, arenis = str(uuid4()), str(uuid4())
    vectors.add(
        [
            chunk(viaro, 1, "Viaro Gehäuse aus Aluminium"),
            chunk(viaro, 2, "Viaro Schutzart IP66 und Schlagfestigkeit IK10"),
            chunk(arenis, 1, "Arenis protection class IP66"),
        ],
        [[0.0], [0.0], [0.0]],
    )
    settings = RetrievalSettings(candidates=20, top_k=1, per_document_cap=5)
    evaluator = RetrievalEvaluator(vectors, FakeEmbedder(dim=1), settings, FakeTicker())
    return evaluator, vectors, EvalCorpus({"viaro": viaro, "arenis": arenis})


def test_rank_and_sources_on_page_level() -> None:
    evaluator, _, corpus = setup()
    [outcome] = evaluator.outcomes(
        [question("Viaro Schutzart IP66 IK10", {"viaro": {2}})], corpus, SearchMode.HYBRID
    )
    assert outcome.rank == 1 and outcome.in_sources
    [miss] = evaluator.outcomes(
        [question("Viaro Aluminium", {"viaro": {2}})], corpus, SearchMode.HYBRID
    )
    assert miss.rank == 2 and not miss.in_sources  # top_k is 1 here


def test_scope_follow_up_and_unanswerable_questions() -> None:
    evaluator, vectors, corpus = setup()
    follow_up = question(
        "Und die Schutzart?",
        {"arenis": {1}},
        category=QuestionCategory.FOLLOW_UP,
        previous="Arenis protection",
        scope=("arenis",),
    )
    unanswerable = question("Preis?", {}, category=QuestionCategory.UNANSWERABLE)
    outcomes = evaluator.outcomes([follow_up, unanswerable], corpus, SearchMode.BM25)
    assert [o.rank for o in outcomes] == [1]
    text, document_ids, _ = vectors.searches[-1]
    assert text == "Arenis protection\nUnd die Schutzart?"
    assert document_ids == (corpus.documents["arenis"],)


def test_full_context_view_compares_one_small_document() -> None:
    evaluator, _, corpus = setup()
    comparison = evaluator.full_context(
        [question("Viaro Aluminium", {"viaro": {2}}), question("x", {"viaro": {1}, "arenis": {1}})],
        corpus,
    )
    assert comparison.questions == 1  # the second question spans two documents
    assert comparison.retrieval_in_sources == 0.0 and comparison.full_context_in_sources == 1.0
    assert comparison.full_context_tokens > comparison.retrieval_tokens
