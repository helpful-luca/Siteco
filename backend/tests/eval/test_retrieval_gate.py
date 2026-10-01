"""Retrieval gate (CI job `eval`): the default configuration must not fall below what it
measured on the golden set. Runs the real pipeline (pdfium, chunker, Granite, LanceDB), so it
needs the embedding model: `EMBEDDING_CACHE_DIR=.models uv run pytest tests/eval -m model`.

Thresholds sit slightly below the values measured on 2026-10-01 (commit in
`eval/results/latest.json`); 28 answerable questions, so one question is about 0.036.
Raise them when retrieval gets better, never lower them to make a change pass.
"""

import asyncio
import os
from pathlib import Path

import pytest

from docchat.cli.eval_results_file import EvalResultsFile
from docchat.cli.run_eval import EVAL_DIR, run
from docchat.domain.eval_set import QuestionCategory

BACKEND = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(
    os.environ.get("EMBEDDING_CACHE_DIR")
    or (BACKEND / ".models" if (BACKEND / ".models").exists() else "/opt/models")
)

pytestmark = [
    pytest.mark.model,
    pytest.mark.skipif(not CACHE_DIR.exists(), reason="embedding model cache not present"),
]

# Measured: Hit@1 0.46, Hit@5 0.89, MRR@10 0.66, in sources 0.93.
MIN_HIT_AT_5 = 0.85
MIN_MRR_AT_10 = 0.62
MIN_IN_SOURCES = 0.89
# Measured per category (in sources): exact codes 1.00, cross-lingual 0.83, follow-up 1.00.
MIN_CATEGORY_IN_SOURCES = {
    QuestionCategory.EXACT_CODE: 0.87,
    QuestionCategory.CROSS_LINGUAL: 0.80,
    QuestionCategory.FOLLOW_UP: 0.95,
}


@pytest.fixture(scope="module")
def results(tmp_path_factory: pytest.TempPathFactory) -> EvalResultsFile:
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("EMBEDDING_CACHE_DIR", str(CACHE_DIR))
        return asyncio.run(run(EVAL_DIR, tmp_path_factory.mktemp("eval-data")))


def test_the_default_configuration_keeps_its_quality(results: EvalResultsFile) -> None:
    [default] = [c for c in results.configs if c.default]
    assert default.search == "hybrid"
    metrics = default.metrics
    assert metrics.hit_at_5 >= MIN_HIT_AT_5, metrics
    assert metrics.mrr_at_10 >= MIN_MRR_AT_10, metrics
    assert metrics.in_sources >= MIN_IN_SOURCES, metrics
    for category, minimum in MIN_CATEGORY_IN_SOURCES.items():
        assert default.by_category[category].in_sources >= minimum, (category, default)


def test_hybrid_finds_at_least_what_each_retriever_finds_alone(results: EvalResultsFile) -> None:
    """Why the app pays for two retrievers: neither alone reaches the hybrid's sources."""
    by_id = {c.id: c.metrics for c in results.configs}
    [default] = [c for c in results.configs if c.default]
    assert default.metrics.in_sources >= by_id["dense"].in_sources
    assert default.metrics.in_sources >= max(
        m.in_sources for i, m in by_id.items() if i.startswith("bm25")
    )
