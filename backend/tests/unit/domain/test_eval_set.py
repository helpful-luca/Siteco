import json
from pathlib import Path
from typing import Any

import pytest

from docchat.domain.eval_set import EvalSetError, QuestionCategory, parse_eval_set

GOLDEN = Path(__file__).resolve().parents[4] / "eval" / "golden.json"


def raw(**question: Any) -> dict[str, Any]:
    base = {
        "id": "q1",
        "category": "factual",
        "language": "de",
        "question": "Welche Schutzart?",
        "relevant": [{"document": "d1", "pages": [2]}],
        "keywords": ["IP66"],
        "scope": None,
        "previous": None,
    }
    document = {"id": "d1", "file": "d1.pdf", "sha256": "0" * 64, "language": "de",
                "fictional": True, "title": "D1"}  # fmt: skip
    return {"version": 1, "documents": [document], "questions": [base | question]}


def test_the_committed_golden_set_parses() -> None:
    golden = parse_eval_set(json.loads(GOLDEN.read_text(encoding="utf-8")))
    categories = {q.category for q in golden.questions}
    assert categories == set(QuestionCategory)
    assert len(golden.questions) >= 30
    assert {q.language for q in golden.questions} == {"de", "en"}


def test_a_hit_is_a_relevant_document_and_page() -> None:
    [question] = parse_eval_set(raw()).questions
    assert question.is_hit("d1", 2)
    assert not question.is_hit("d1", 3) and not question.is_hit("d2", 2)
    assert not question.is_hit("d1", None)


@pytest.mark.parametrize(
    "change",
    [
        {"relevant": [{"document": "nope", "pages": [1]}]},
        {"category": "unanswerable"},  # but it has relevant pages
        {"category": "follow_up"},  # without the previous question
        {"category": "nonsense"},
        {"relevant": "x"},
    ],
)
def test_inconsistent_questions_are_refused(change: dict[str, Any]) -> None:
    with pytest.raises(EvalSetError):
        parse_eval_set(raw(**change))
