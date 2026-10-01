"""Asks the golden questions against an index built by the real ingestion pipeline and records
where the right page lands (annex 11, 9.1). Production code paths throughout: the follow-up
query, the vector store's search and the source selection an answer would get."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from docchat.domain.chunking import estimate_tokens
from docchat.domain.enums import SearchMode
from docchat.domain.eval_metrics import QuestionOutcome
from docchat.domain.eval_set import EvalQuestion
from docchat.domain.models import Chunk
from docchat.domain.ports import Embedder, MonotonicClock, VectorStore
from docchat.domain.retrieval import follow_up_query, select_sources
from docchat.services.retrieval_service import RetrievalSettings


@dataclass(frozen=True)
class EvalCorpus:
    """The golden set's document ids mapped to the ids the library gave them."""

    documents: Mapping[str, str]

    def golden_id(self, document_id: str) -> str | None:
        return next((g for g, d in self.documents.items() if d == document_id), None)


@dataclass(frozen=True)
class FullContextComparison:
    """Questions about one small document: top-k retrieval against sending it whole (4.5)."""

    questions: int
    retrieval_in_sources: float
    retrieval_tokens: float  # average tokens of the passages an answer gets
    full_context_in_sources: float
    full_context_tokens: float


def _tokens(chunks: Sequence[Chunk]) -> int:
    return sum(estimate_tokens(c.text) for c in chunks)


class RetrievalEvaluator:
    def __init__(
        self,
        vectors: VectorStore,
        embedder: Embedder,
        settings: RetrievalSettings,
        clock: MonotonicClock,
    ) -> None:
        self._vectors = vectors
        self._embedder = embedder
        self._settings = settings
        self._clock = clock

    def _hit(self, question: EvalQuestion, chunk: Chunk, corpus: EvalCorpus) -> bool:
        golden = corpus.golden_id(chunk.document_id)
        return golden is not None and question.is_hit(golden, chunk.page)

    def _scope(self, question: EvalQuestion, corpus: EvalCorpus) -> list[str]:
        if question.scope is None:
            return list(corpus.documents.values())
        return [corpus.documents[d] for d in question.scope]

    def _search(
        self, query: str, document_ids: Sequence[str], mode: SearchMode
    ) -> tuple[list[Chunk], float]:
        started = self._clock.monotonic()
        # BM25 alone needs no query vector; the timing covers exactly what each mode does.
        vector = [] if mode is SearchMode.BM25 else self._embedder.embed_query(query)
        ranked = self._vectors.search(
            query, vector, document_ids, self._settings.candidates, mode=mode
        )
        return ranked, (self._clock.monotonic() - started) * 1000

    def _sources(self, ranked: Sequence[Chunk], document_ids: Sequence[str]) -> list[Chunk]:
        return select_sources(
            ranked,
            top_k=self._settings.top_k,
            per_document_cap=self._settings.per_document_cap,
            multiple_documents=len(document_ids) > 1,
        )

    def outcomes(
        self, questions: Sequence[EvalQuestion], corpus: EvalCorpus, mode: SearchMode
    ) -> list[QuestionOutcome]:
        """One outcome per answerable question; unanswerable ones have no page to find."""
        results = []
        for question in questions:
            if not question.answerable:
                continue
            document_ids = self._scope(question, corpus)
            query = follow_up_query(question.previous, question.question)
            ranked, latency_ms = self._search(query, document_ids, mode)
            rank = next(
                (i for i, c in enumerate(ranked, start=1) if self._hit(question, c, corpus)), None
            )
            in_sources = any(
                self._hit(question, c, corpus) for c in self._sources(ranked, document_ids)
            )
            results.append(
                QuestionOutcome(question.id, question.category, rank, in_sources, latency_ms)
            )
        return results

    def full_context(
        self, questions: Sequence[EvalQuestion], corpus: EvalCorpus
    ) -> FullContextComparison:
        """For every question whose pages are all in one document small enough for the
        full-context mode: what a chat limited to that document gets either way."""
        retrieval_hits, full_hits, retrieval_tokens, full_tokens = [], [], [], []
        for question in questions:
            documents = {r.document for r in question.relevant}
            if len(documents) != 1:
                continue
            document_id = corpus.documents[documents.pop()]
            whole = self._vectors.chunks_of([document_id])
            if _tokens(whole) > self._settings.full_context_max_tokens:
                continue
            query = follow_up_query(question.previous, question.question)
            ranked, _ = self._search(query, [document_id], SearchMode.HYBRID)
            sources = self._sources(ranked, [document_id])
            retrieval_hits.append(any(self._hit(question, c, corpus) for c in sources))
            full_hits.append(any(self._hit(question, c, corpus) for c in whole))
            retrieval_tokens.append(_tokens(sources))
            full_tokens.append(_tokens(whole))
        count = len(retrieval_hits)

        def mean(values: Sequence[float]) -> float:
            return sum(values) / count if count else 0.0

        return FullContextComparison(
            questions=count,
            retrieval_in_sources=mean([float(h) for h in retrieval_hits]),
            retrieval_tokens=mean(retrieval_tokens),
            full_context_in_sources=mean([float(h) for h in full_hits]),
            full_context_tokens=mean(full_tokens),
        )
