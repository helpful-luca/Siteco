"""Retrieval eval (`make eval`): indexes `eval/documents` with the production pipeline in a
temporary data directory, asks the golden questions in several configurations and writes
`eval/results/latest.json`. Never touches the app's own data (annex 10, N6).

Configurations: dense only, BM25 only and hybrid (the app's default), BM25 with German, English
or no stemming, and a full-context view for questions about one small document.
"""

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
import tempfile
from collections import Counter
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from docchat.adapters.lancedb_vector_store import LanceVectorStore
from docchat.adapters.system_clock import SystemClock
from docchat.api.schemas.evaluation import (
    EvalConfigOut,
    EvalDatasetOut,
    EvalMetricsOut,
    EvalMissOut,
    EvalResultsFile,
    FullContextOut,
    Stemming,
)
from docchat.core.config import Settings
from docchat.core.container import Container, build_container
from docchat.core.retrieval_fingerprint import retrieval_fingerprint
from docchat.domain.enums import DocumentStatus, SearchMode
from docchat.domain.eval_config import config_hash
from docchat.domain.eval_metrics import QuestionOutcome, summarize, summarize_by_category
from docchat.domain.eval_set import EvalSet, parse_eval_set
from docchat.services.retrieval_eval import EvalCorpus, RetrievalEvaluator
from docchat.services.retrieval_service import RetrievalSettings

REPO = Path(__file__).resolve().parents[4]
EVAL_DIR = REPO / "eval"
INGEST_TIMEOUT_S = 900
_STEMMERS: dict[Stemming, str | None] = {"german": "German", "english": "English", "none": None}


@dataclass(frozen=True)
class EvalConfig:
    id: str
    search: SearchMode
    stemming: Stemming | None


def configurations(app_language: str) -> list[EvalConfig]:
    """Hybrid with the app's stemmer first (the default), then the variants."""
    default: Stemming = "english" if app_language.lower() == "english" else "german"
    others = [s for s in _STEMMERS if s != default]
    return [
        EvalConfig(f"hybrid-{default}", SearchMode.HYBRID, default),
        EvalConfig("dense", SearchMode.DENSE, None),
        EvalConfig(f"bm25-{default}", SearchMode.BM25, default),
        *(EvalConfig(f"bm25-{s}", SearchMode.BM25, s) for s in others),
        *(EvalConfig(f"hybrid-{s}", SearchMode.HYBRID, s) for s in others),
    ]


def commit() -> str:
    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=False)

    head = git("rev-parse", "--short", "HEAD")
    if head.returncode != 0:
        return "unknown"
    dirty = git("diff", "--quiet", "HEAD", "--", "backend/src", "eval", ":(exclude)eval/results")
    return head.stdout.strip() + ("-dirty" if dirty.returncode != 0 else "")


def load_eval_set(eval_dir: Path) -> EvalSet:
    golden = parse_eval_set(json.loads((eval_dir / "golden.json").read_text(encoding="utf-8")))
    for document in golden.documents:
        digest = hashlib.sha256((eval_dir / document.file).read_bytes()).hexdigest()
        if digest != document.sha256:
            raise SystemExit(f"{document.file}: checksum differs from golden.json")
    return golden


async def _body(data: bytes) -> AsyncIterator[bytes]:
    yield data


async def ingest(container: Container, golden: EvalSet, eval_dir: Path) -> EvalCorpus:
    """Uploads every document like the app does and waits until all are ready."""
    ids: dict[str, str] = {}
    for document in golden.documents:
        data = (eval_dir / document.file).read_bytes()
        name = Path(document.file).name
        ids[document.id] = (await container.uploads.accept(name, len(data), _body(data))).id
    async with asyncio.timeout(INGEST_TIMEOUT_S):
        while True:
            views = [await asyncio.to_thread(container.documents.get, i) for i in ids.values()]
            if failed := [v.document for v in views if v.document.status is DocumentStatus.FAILED]:
                raise SystemExit(
                    f"ingestion failed: {[(d.filename, d.error_code) for d in failed]}"
                )
            if all(v.document.status is DocumentStatus.READY for v in views):
                return EvalCorpus(ids)
            await asyncio.sleep(0.5)


def dataset(golden: EvalSet, container: Container, corpus: EvalCorpus) -> EvalDatasetOut:
    documents = [container.documents.get(i).document for i in corpus.documents.values()]
    return EvalDatasetOut(
        questions=len(golden.questions),
        answerable=sum(q.answerable for q in golden.questions),
        by_category=dict(Counter(q.category for q in golden.questions)),
        by_language=dict(Counter(q.language for q in golden.questions)),
        documents=len(documents),
        pages=sum(d.page_count or 0 for d in documents),
        chunks=sum(d.chunk_count or 0 for d in documents),
    )


def config_out(
    config: EvalConfig, outcomes: Sequence[QuestionOutcome], default: bool
) -> EvalConfigOut:
    return EvalConfigOut(
        id=config.id,
        search=config.search,
        stemming=config.stemming,
        default=default,
        metrics=EvalMetricsOut.from_metrics(summarize(outcomes)),
        by_category={
            c: EvalMetricsOut.from_metrics(m) for c, m in summarize_by_category(outcomes).items()
        },
    )


def evaluate(
    golden: EvalSet, container: Container, corpus: EvalCorpus, settings: Settings
) -> EvalResultsFile:
    vectors = container.vectors
    if not isinstance(vectors, LanceVectorStore):
        raise TypeError("the eval needs the LanceDB store")
    evaluator = RetrievalEvaluator(
        vectors,
        container.embedder,
        RetrievalSettings(
            candidates=settings.retrieval_candidates,
            top_k=settings.top_k,
            per_document_cap=settings.per_document_cap,
            full_context_max_tokens=settings.full_context_max_tokens,
        ),
        SystemClock(),
    )
    configs = configurations(settings.fts_language)
    # Warm up the query path once, so the first configuration's latency is not a cold start.
    evaluator.outcomes(golden.questions[:3], corpus, SearchMode.HYBRID)
    results: dict[str, list[QuestionOutcome]] = {}
    for stemming in [s for s in _STEMMERS if any(c.stemming == s for c in configs)]:
        vectors.rebuild_text_index(_STEMMERS[stemming])
        for config in configs:
            if config.stemming == stemming or (
                config.stemming is None and config.id not in results
            ):
                results[config.id] = evaluator.outcomes(golden.questions, corpus, config.search)
    vectors.rebuild_text_index(_STEMMERS[configs[0].stemming or "german"])
    full_context = evaluator.full_context(golden.questions, corpus)
    default_outcomes = results[configs[0].id]
    questions = {q.id: q for q in golden.questions}
    fingerprint = retrieval_fingerprint(settings)
    return EvalResultsFile(
        created_at=datetime.now(UTC).replace(microsecond=0),
        commit=commit(),
        config_hash=config_hash(fingerprint),
        settings=fingerprint,
        dataset=dataset(golden, container, corpus),
        configs=[config_out(c, results[c.id], i == 0) for i, c in enumerate(configs)],
        full_context=FullContextOut(
            questions=full_context.questions,
            retrieval_in_sources=round(full_context.retrieval_in_sources, 4),
            retrieval_tokens=round(full_context.retrieval_tokens, 1),
            full_context_in_sources=round(full_context.full_context_in_sources, 4),
            full_context_tokens=round(full_context.full_context_tokens, 1),
        ),
        misses=[
            EvalMissOut(
                question_id=o.question_id,
                category=o.category,
                question=questions[o.question_id].question,
                rank=o.rank,
            )
            for o in default_outcomes
            if not o.in_sources
        ],
    )


async def run(eval_dir: Path, data_dir: Path) -> EvalResultsFile:
    golden = load_eval_set(eval_dir)
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        data_dir=data_dir,
        malware_scan="off",  # the files are ours and checksummed
        ocr="off",
        llm_provider="fake",
        anthropic_api_key=None,
    )
    container = build_container(settings)
    await container.start()
    try:
        corpus = await ingest(container, golden, eval_dir)
        return await asyncio.to_thread(evaluate, golden, container, corpus, settings)
    finally:
        await container.stop()


def table(results: EvalResultsFile) -> str:
    """The summary printed after a run, also handy for the README."""
    lines = [
        "| Configuration | Hit@1 | Hit@5 | MRR@10 | In sources | p50 ms | p95 ms |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in results.configs:
        m = c.metrics
        name = f"{c.id} (default)" if c.default else c.id
        lines.append(
            f"| {name} | {m.hit_at_1:.2f} | {m.hit_at_5:.2f} | {m.mrr_at_10:.2f} | "
            f"{m.in_sources:.2f} | {m.latency_p50_ms:.0f} | {m.latency_p95_ms:.0f} |"
        )
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eval-dir", type=Path, default=EVAL_DIR)
    parser.add_argument(
        "--out", type=Path, default=None, help="default: <eval-dir>/results/latest.json"
    )
    args = parser.parse_args(argv)
    with tempfile.TemporaryDirectory(prefix="docchat-eval-") as tmp:
        results = asyncio.run(run(args.eval_dir, Path(tmp)))
    out: Path = args.out or args.eval_dir / "results" / "latest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(results.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(table(results))
    print(f"written: {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
