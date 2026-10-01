"""The golden question set of the retrieval eval (`eval/golden.json`). Pure parsing, no I/O.

Labels are pages, not chunk ids, so chunking variants stay comparable: a retrieved chunk is a
hit when its document and page match any of the question's `relevant` entries.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class QuestionCategory(StrEnum):
    FACTUAL = "factual"
    EXACT_CODE = "exact_code"  # IP66, EN 13201-2, article numbers, limit values
    CROSS_LINGUAL = "cross_lingual"  # German question on English text and the other way round
    FOLLOW_UP = "follow_up"  # only makes sense with the previous question
    UNANSWERABLE = "unanswerable"  # not in any document: nothing to find


@dataclass(frozen=True)
class EvalDocument:
    id: str
    file: str
    sha256: str
    language: str
    fictional: bool
    title: str


@dataclass(frozen=True)
class RelevantPages:
    document: str
    pages: frozenset[int]


@dataclass(frozen=True)
class EvalQuestion:
    id: str
    category: QuestionCategory
    language: str
    question: str
    relevant: tuple[RelevantPages, ...]
    keywords: tuple[str, ...] = ()
    scope: tuple[str, ...] | None = None  # document ids; None: the whole library
    previous: str | None = None  # the question before a follow-up

    @property
    def answerable(self) -> bool:
        return bool(self.relevant)

    def is_hit(self, document: str, page: int | None) -> bool:
        return page is not None and any(
            r.document == document and page in r.pages for r in self.relevant
        )


@dataclass(frozen=True)
class EvalSet:
    documents: tuple[EvalDocument, ...]
    questions: tuple[EvalQuestion, ...]


class EvalSetError(ValueError):
    """The golden set does not fit its schema or refers to unknown documents."""


def _question(raw: Mapping[str, Any], known: set[str]) -> EvalQuestion:
    relevant = tuple(
        RelevantPages(str(r["document"]), frozenset(int(p) for p in r["pages"]))
        for r in raw["relevant"]
    )
    scope = tuple(str(d) for d in raw["scope"]) if raw.get("scope") else None
    question = EvalQuestion(
        id=str(raw["id"]),
        category=QuestionCategory(raw["category"]),
        language=str(raw["language"]),
        question=str(raw["question"]),
        relevant=relevant,
        keywords=tuple(str(k) for k in raw.get("keywords") or ()),
        scope=scope,
        previous=str(raw["previous"]) if raw.get("previous") else None,
    )
    referenced = {r.document for r in relevant} | set(scope or ())
    if unknown := referenced - known:
        raise EvalSetError(f"{question.id}: unknown documents {sorted(unknown)}")
    if (question.category is QuestionCategory.UNANSWERABLE) == question.answerable:
        raise EvalSetError(f"{question.id}: only unanswerable questions have no relevant pages")
    if (question.category is QuestionCategory.FOLLOW_UP) != (question.previous is not None):
        raise EvalSetError(f"{question.id}: follow-up questions, and only they, need `previous`")
    return question


def parse_eval_set(raw: Mapping[str, Any]) -> EvalSet:
    """Raises EvalSetError for anything that would make the numbers meaningless."""
    try:
        documents = tuple(
            EvalDocument(
                id=str(d["id"]),
                file=str(d["file"]),
                sha256=str(d["sha256"]),
                language=str(d["language"]),
                fictional=bool(d["fictional"]),
                title=str(d["title"]),
            )
            for d in raw["documents"]
        )
        known = {d.id for d in documents}
        questions = tuple(_question(q, known) for q in raw["questions"])
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, EvalSetError):
            raise
        raise EvalSetError(f"golden set does not fit the schema: {exc}") from exc
    ids = [q.id for q in questions]
    if len(ids) != len(set(ids)):
        raise EvalSetError("question ids must be unique")
    return EvalSet(documents, questions)
