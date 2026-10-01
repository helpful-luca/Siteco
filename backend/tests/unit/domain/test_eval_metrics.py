import pytest

from docchat.domain.eval_metrics import (
    QuestionOutcome,
    percentile,
    summarize,
    summarize_by_category,
)
from docchat.domain.eval_set import QuestionCategory

FACT, CODE = QuestionCategory.FACTUAL, QuestionCategory.EXACT_CODE


def outcome(
    rank: int | None, category: QuestionCategory = FACT, latency: float = 10.0
) -> QuestionOutcome:
    return QuestionOutcome(
        "q", category, rank, in_sources=rank is not None and rank <= 8, latency_ms=latency
    )


def test_hits_and_reciprocal_rank() -> None:
    metrics = summarize([outcome(1), outcome(3), outcome(12), outcome(None)])
    assert metrics.questions == 4
    assert metrics.hit_at_1 == 0.25
    assert metrics.hit_at_5 == 0.5
    assert metrics.mrr_at_10 == pytest.approx((1 + 1 / 3) / 4)  # rank 12 is beyond MRR@10
    assert metrics.in_sources == 0.5


def test_latency_percentiles_interpolate() -> None:
    assert percentile([], 0.5) == 0.0
    assert percentile([5.0], 0.95) == 5.0
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile(list(range(1, 101)), 0.95) == pytest.approx(95.05)


def test_by_category_skips_categories_without_questions() -> None:
    groups = summarize_by_category([outcome(1), outcome(2, CODE), outcome(None, CODE)])
    assert set(groups) == {FACT, CODE}
    assert groups[CODE].hit_at_1 == 0.0 and groups[CODE].hit_at_5 == 0.5
