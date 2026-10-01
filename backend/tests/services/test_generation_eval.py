"""The generation eval with the fake model and a fake judge: no network, no cost."""

from pathlib import Path

import pytest

from docchat.cli import run_generation_eval
from docchat.domain.eval_set import EvalQuestion, QuestionCategory, RelevantPages
from docchat.services.generation_eval import GenerationEvaluator
from docchat.services.retrieval_eval import EvalCorpus
from tests.services.chat_support import build_chat_harness


class RecordingJudge:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, bool]] = []

    def judge(self, question: str, answer: str, evidence: str, *, answerable: bool) -> bool:
        self.calls.append((question, answer, evidence, answerable))
        return "IP66" in answer if answerable else True


async def test_answers_go_through_the_app_and_are_scored(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    document = h.add_document(("Kopfzeile ohne Satz", "Die Leuchte Mira hat die Schutzart IP66."))
    corpus = EvalCorpus({"mira": document.id})
    judge = RecordingJudge()
    evaluator = GenerationEvaluator(h.chats, h.answers, h.vectors, judge)
    questions = [
        EvalQuestion("q1", QuestionCategory.FACTUAL, "de", "Welche Schutzart hat die Mira?",
                     (RelevantPages("mira", frozenset({2})),)),
        EvalQuestion("q2", QuestionCategory.UNANSWERABLE, "de", "Was kostet die Mira?", ()),
    ]  # fmt: skip
    answers = [await evaluator.answer(q, corpus, "claude-haiku-4-5") for q in questions]
    assert answers[0].answered and answers[0].cited_pages == (("mira", 2),)
    assert answers[0].cost_usd > 0
    score = evaluator.score("claude-haiku-4-5", questions, answers, corpus)
    assert (score.correct, score.citation_accuracy, score.abstention) == (1.0, 1.0, 1.0)
    assert judge.calls[0][2] == "Die Leuchte Mira hat die Schutzart IP66."  # the labelled page
    assert h.chats.list_chats() == []  # every question had its own chat, deleted afterwards


def test_the_live_run_is_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RUN_LIVE", raising=False)
    assert run_generation_eval.main([]) == 2
    monkeypatch.setenv("RUN_LIVE", "1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert run_generation_eval.main([]) == 2
