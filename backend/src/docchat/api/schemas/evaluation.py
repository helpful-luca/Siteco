"""The eval results file (`eval/results/latest.json`, written by `docchat.cli.run_eval`) and the
optional generation results (`generation.json`, `docchat.cli.run_generation_eval`). The same
models write and read them, so the file and `GET /api/eval` cannot drift apart."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from docchat.domain.enums import SearchMode
from docchat.domain.eval_metrics import Metrics
from docchat.domain.eval_set import QuestionCategory

Stemming = Literal["german", "english", "none"]


class EvalMetricsOut(BaseModel):
    questions: int
    hit_at_1: float = Field(description="Share of questions whose first result is on a right page.")
    hit_at_5: float
    mrr_at_10: float = Field(description="Mean of 1/rank of the first right page, 0 beyond 10.")
    in_sources: float = Field(
        description="Share with a right page among the passages an answer gets."
    )
    latency_p50_ms: float
    latency_p95_ms: float

    @classmethod
    def from_metrics(cls, m: Metrics) -> "EvalMetricsOut":
        return cls(
            questions=m.questions,
            hit_at_1=round(m.hit_at_1, 4),
            hit_at_5=round(m.hit_at_5, 4),
            mrr_at_10=round(m.mrr_at_10, 4),
            in_sources=round(m.in_sources, 4),
            latency_p50_ms=round(m.latency_p50_ms, 1),
            latency_p95_ms=round(m.latency_p95_ms, 1),
        )


class EvalConfigOut(BaseModel):
    id: str
    search: SearchMode
    stemming: Stemming | None = Field(description="BM25 stemmer; none for dense search.")
    default: bool = Field(description="What the app answers with.")
    metrics: EvalMetricsOut
    by_category: dict[QuestionCategory, EvalMetricsOut]


class EvalDatasetOut(BaseModel):
    questions: int
    answerable: int
    by_category: dict[QuestionCategory, int]
    by_language: dict[str, int]
    documents: int
    pages: int
    chunks: int


class FullContextOut(BaseModel):
    """Questions about one small document: the top passages against the whole document."""

    questions: int
    retrieval_in_sources: float
    retrieval_tokens: float
    full_context_in_sources: float
    full_context_tokens: float


class EvalMissOut(BaseModel):
    """A question whose right page the default configuration does not put among the sources."""

    question_id: str
    category: QuestionCategory
    question: str
    rank: int | None


class EvalResultsFile(BaseModel):
    schema_version: Literal[1] = 1
    created_at: datetime
    commit: str
    config_hash: str
    settings: dict[str, str | int | float | None]
    dataset: EvalDatasetOut
    configs: list[EvalConfigOut]
    full_context: FullContextOut
    misses: list[EvalMissOut]


class GenerationModelOut(BaseModel):
    model: str
    questions: int
    correct: float = Field(description="Share of answerable questions the judge marked correct.")
    citation_accuracy: float = Field(description="Share of citations on a right page.")
    abstention: float = Field(description="Share of unanswerable questions declined honestly.")
    cost_usd: float = Field(description="All answers together, judge excluded.")
    latency_p50_ms: float
    ttft_p50_ms: float


class GenerationResultsFile(BaseModel):
    schema_version: Literal[1] = 1
    created_at: datetime
    commit: str
    judge_model: str
    models: list[GenerationModelOut]


class EvalOut(EvalResultsFile):
    stale: bool = Field(description="The results belong to other retrieval settings.")
    generation: GenerationResultsFile | None = None
