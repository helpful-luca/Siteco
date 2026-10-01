"""Generation eval (`make eval-generation`, needs a key, costs money): every golden question
goes through the app's own answer path for each model, then a judge grades the answer. Measures
correctness, citations on a right page, honest refusals, cost and latency per model."""

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import uuid4

from docchat.domain.enums import ChatScope, Locale, MessageStatus
from docchat.domain.eval_metrics import percentile
from docchat.domain.eval_set import EvalQuestion
from docchat.domain.ports import AnswerJudge, VectorStore
from docchat.services.answer_service import AnswerOptions, AnswerService, AskCommand
from docchat.services.chat_service import ChatService
from docchat.services.retrieval_eval import EvalCorpus
from docchat.services.run_events import CitationEvent, DeltaEvent, DoneEvent, RunEvent, SourcesEvent

_ANSWERED = frozenset({MessageStatus.COMPLETE, MessageStatus.TRUNCATED})


@dataclass(frozen=True)
class GeneratedAnswer:
    question_id: str
    model: str
    text: str
    answered: bool  # the run ended complete or truncated
    cited_pages: tuple[tuple[str, int | None], ...]  # (golden document id, page) per citation
    cost_usd: float
    total_ms: int
    ttft_ms: int | None


@dataclass(frozen=True)
class ModelScore:
    model: str
    questions: int
    correct: float
    citation_accuracy: float
    abstention: float
    cost_usd: float
    latency_p50_ms: float
    ttft_p50_ms: float


class GenerationEvaluator:
    def __init__(
        self,
        chats: ChatService,
        answers: AnswerService,
        vectors: VectorStore,
        judge: AnswerJudge,
    ) -> None:
        self._chats = chats
        self._answers = answers
        self._vectors = vectors
        self._judge = judge

    async def _ask(self, chat_id: str, question: str, model: str, locale: Locale) -> list[RunEvent]:
        run = await self._answers.ask(
            AskCommand(
                chat_id=chat_id,
                client_message_id=str(uuid4()),
                content=question,
                options=AnswerOptions(model=model, locale=locale),
            )
        )
        return [event async for event in run.events()]

    async def answer(
        self, question: EvalQuestion, corpus: EvalCorpus, model: str
    ) -> GeneratedAnswer:
        """A fresh chat per question; a follow-up first asks the question before it."""
        scope = [corpus.documents[d] for d in question.scope] if question.scope else None
        chat = self._chats.create(ChatScope.SELECTED if scope else ChatScope.ALL, scope)
        locale = Locale(question.language)
        try:
            if question.previous:
                await self._ask(chat.id, question.previous, model, locale)
            events = await self._ask(chat.id, question.question, model, locale)
        finally:
            await self._chats.delete(chat.id)
        sources = {
            s.id: (corpus.golden_id(s.document_id) or "", s.page)
            for e in events
            if isinstance(e, SourcesEvent)
            for s in e.sources
        }
        done = next((e for e in events if isinstance(e, DoneEvent)), None)
        return GeneratedAnswer(
            question_id=question.id,
            model=model,
            text="".join(e.text for e in events if isinstance(e, DeltaEvent)),
            answered=done is not None and done.status in _ANSWERED,
            cited_pages=tuple(
                sources.get(e.citation.source_id, ("", None))
                for e in events
                if isinstance(e, CitationEvent)
            ),
            cost_usd=done.cost_usd if done else 0.0,
            total_ms=done.total_ms if done else 0,
            ttft_ms=done.ttft_ms if done else None,
        )

    def evidence(self, question: EvalQuestion, corpus: EvalCorpus) -> str:
        """The text of the labelled pages, what a correct answer must agree with."""
        parts: list[str] = []
        for relevant in question.relevant:
            chunks = self._vectors.chunks_of([corpus.documents[relevant.document]])
            parts.extend(c.text for c in chunks if c.page in relevant.pages)
        return "\n\n".join(parts)

    def score(
        self, model: str, questions: Sequence[EvalQuestion], answers: Sequence[GeneratedAnswer],
        corpus: EvalCorpus,
    ) -> ModelScore:  # fmt: skip
        by_id = {q.id: q for q in questions}
        correct: list[bool] = []
        abstained: list[bool] = []
        cited = cited_right = 0
        for answer in answers:
            question = by_id[answer.question_id]
            verdict = answer.answered and self._judge.judge(
                question.question,
                answer.text,
                self.evidence(question, corpus),
                answerable=question.answerable,
            )
            (correct if question.answerable else abstained).append(verdict)
            if question.answerable:
                cited += len(answer.cited_pages)
                cited_right += sum(question.is_hit(d, p) for d, p in answer.cited_pages)
        return ModelScore(
            model=model,
            questions=len(answers),
            correct=sum(correct) / len(correct) if correct else 0.0,
            citation_accuracy=cited_right / cited if cited else 0.0,
            abstention=sum(abstained) / len(abstained) if abstained else 0.0,
            cost_usd=sum(a.cost_usd for a in answers),
            latency_p50_ms=percentile([float(a.total_ms) for a in answers], 0.5),
            ttft_p50_ms=percentile(
                [float(a.ttft_ms) for a in answers if a.ttft_ms is not None], 0.5
            ),
        )
