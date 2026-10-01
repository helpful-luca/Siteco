"""Generation eval (`make eval-generation`): asks every golden question through the app's
answer path with Haiku, Sonnet and Opus, lets Claude judge the answers and writes
`eval/results/generation.json`. Costs money: needs RUN_LIVE=1 and ANTHROPIC_API_KEY, never runs
in CI or the gates."""

import argparse
import asyncio
import os
import sys
import tempfile
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from pydantic import SecretStr

from docchat.adapters.anthropic.answer_judge import JUDGE_MODEL, ClaudeAnswerJudge
from docchat.api.schemas.evaluation import GenerationModelOut, GenerationResultsFile
from docchat.cli.run_eval import EVAL_DIR, commit, ingest, load_eval_set
from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.services.generation_eval import GenerationEvaluator, ModelScore

MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5")


def allowed() -> str | None:
    """The API key, or None with the reason printed: this run is opt-in."""
    if os.environ.get("RUN_LIVE") != "1":
        print("The generation eval calls Claude and costs money: set RUN_LIVE=1.", file=sys.stderr)
        return None
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print("ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return None
    return key


def model_out(score: ModelScore) -> GenerationModelOut:
    return GenerationModelOut(
        model=score.model,
        questions=score.questions,
        correct=round(score.correct, 4),
        citation_accuracy=round(score.citation_accuracy, 4),
        abstention=round(score.abstention, 4),
        cost_usd=round(score.cost_usd, 4),
        latency_p50_ms=round(score.latency_p50_ms, 1),
        ttft_p50_ms=round(score.ttft_p50_ms, 1),
    )


async def run(
    eval_dir: Path, data_dir: Path, key: str, models: Sequence[str], judge_model: str
) -> GenerationResultsFile:
    golden = load_eval_set(eval_dir)
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        data_dir=data_dir,
        malware_scan="off",
        ocr="off",
        llm_provider="anthropic",
        anthropic_api_key=SecretStr(key),
        rate_chat_per_min=0,  # our own limit is for people, not for this run
    )
    container = build_container(settings)
    await container.start()
    judge = ClaudeAnswerJudge(key, judge_model)
    evaluator = GenerationEvaluator(container.chats, container.answers, container.vectors, judge)
    try:
        corpus = await ingest(container, golden, eval_dir)
        scores = []
        for model in models:
            answers = [await evaluator.answer(q, corpus, model) for q in golden.questions]
            score = await asyncio.to_thread(
                evaluator.score, model, golden.questions, answers, corpus
            )
            print(
                f"{model}: correct {score.correct:.2f}, cost {score.cost_usd:.3f} USD",
                file=sys.stderr,
            )
            scores.append(score)
    finally:
        await container.stop()
    return GenerationResultsFile(
        created_at=datetime.now(UTC).replace(microsecond=0),
        commit=commit(),
        judge_model=judge_model,
        models=[model_out(s) for s in scores],
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eval-dir", type=Path, default=EVAL_DIR)
    parser.add_argument("--models", nargs="+", default=list(MODELS))
    parser.add_argument("--judge", default=JUDGE_MODEL)
    args = parser.parse_args(argv)
    key = allowed()
    if key is None:
        return 2
    with tempfile.TemporaryDirectory(prefix="docchat-generation-") as tmp:
        results = asyncio.run(run(args.eval_dir, Path(tmp), key, args.models, args.judge))
    out = args.eval_dir / "results" / "generation.json"
    out.write_text(results.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(f"written: {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
