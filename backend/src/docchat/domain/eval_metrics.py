"""Retrieval metrics: Hit@k, MRR@10, how often the answer's sources contain the right page, and
latency percentiles. Pure functions over one outcome per answerable question."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from docchat.domain.eval_set import QuestionCategory

MRR_DEPTH = 10


@dataclass(frozen=True)
class QuestionOutcome:
    question_id: str
    category: QuestionCategory
    rank: int | None  # 1-based rank of the first chunk on a relevant page; None: not found
    in_sources: bool  # a relevant page is among the passages an answer would get
    latency_ms: float  # query embedding plus search


@dataclass(frozen=True)
class Metrics:
    questions: int
    hit_at_1: float
    hit_at_5: float
    mrr_at_10: float
    in_sources: float
    latency_p50_ms: float
    latency_p95_ms: float


def percentile(values: Sequence[float], q: float) -> float:
    """Linear interpolation between the closest ranks (like numpy's default). 0 when empty."""
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _share(flags: Sequence[bool]) -> float:
    return sum(flags) / len(flags) if flags else 0.0


def summarize(outcomes: Sequence[QuestionOutcome]) -> Metrics:
    ranks = [o.rank for o in outcomes]
    latencies = [o.latency_ms for o in outcomes]
    return Metrics(
        questions=len(outcomes),
        hit_at_1=_share([r == 1 for r in ranks]),
        hit_at_5=_share([r is not None and r <= 5 for r in ranks]),
        mrr_at_10=(
            sum(1 / r for r in ranks if r is not None and r <= MRR_DEPTH) / len(ranks)
            if ranks
            else 0.0
        ),
        in_sources=_share([o.in_sources for o in outcomes]),
        latency_p50_ms=percentile(latencies, 0.5),
        latency_p95_ms=percentile(latencies, 0.95),
    )


def summarize_by_category(
    outcomes: Sequence[QuestionOutcome],
) -> dict[QuestionCategory, Metrics]:
    """Only categories with answerable questions: an unanswerable one has no page to find."""
    groups: dict[QuestionCategory, list[QuestionOutcome]] = {}
    for outcome in outcomes:
        groups.setdefault(outcome.category, []).append(outcome)
    return {c: summarize(groups[c]) for c in QuestionCategory if c in groups}
