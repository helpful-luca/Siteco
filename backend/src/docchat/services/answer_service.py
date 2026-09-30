"""Starting answers: every precondition is checked here, before the stream opens (S1).

What fails here leaves the API as plain JSON with a status code. Only when all checks pass is
the question saved, a `streaming` placeholder written and the run task started.
"""

import asyncio
import functools
import logging
import uuid
from collections.abc import Callable, Collection
from dataclasses import dataclass, replace

from docchat.domain.chat_models import Chat, Message
from docchat.domain.chat_title import title_from_question
from docchat.domain.enums import (
    AnswerStyle,
    Effort,
    Lane,
    Locale,
    MessageRole,
    MessageStatus,
)
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.history import build_history
from docchat.domain.model_profiles import MODEL_PROFILES, resolve_effort
from docchat.domain.ports import ChatRepository, DuplicateMessage
from docchat.domain.retrieval import follow_up_query
from docchat.services.answer_run import AnswerRun, RunDeps, RunInput
from docchat.services.limits import DailyBudget, RateLimit
from docchat.services.retrieval_service import RetrievalPlan
from docchat.services.run_registry import RunControl, StopReason

log = logging.getLogger("docchat.answers")


@dataclass(frozen=True)
class AnswerLimits:
    enabled_models: Collection[str]
    default_model: str = "claude-sonnet-5-5"
    max_question_chars: int = 4000
    max_messages_per_chat: int = 200
    max_output_tokens: int = 4096
    history_max_turns: int = 6
    history_max_tokens: int = 6000


@dataclass(frozen=True)
class AnswerOptions:
    model: str | None  # None: the default model (regenerate: the answer's model)
    locale: Locale
    effort: Effort | None = None
    style: AnswerStyle = AnswerStyle.CONCISE


@dataclass(frozen=True)
class AskCommand:
    chat_id: str
    client_message_id: str
    content: str
    options: AnswerOptions
    lane: Lane = Lane.A
    comparison_id: str | None = None


class AnswerService:
    def __init__(
        self,
        deps: RunDeps,
        limits: AnswerLimits,
        *,
        rate: RateLimit | None = None,
        budget: DailyBudget | None = None,
    ) -> None:
        self._deps = deps
        self._limits = limits
        self._rate = rate  # chat requests per minute; None: no limit
        self._budget = budget  # None or a budget without a limit: no brake

    @property
    def _chats(self) -> ChatRepository:
        return self._deps.chats

    # Checks

    def _question(self, content: str) -> str:
        question = content.strip()
        if not question:
            raise AppError(ErrorCode.QUESTION_EMPTY)
        if len(question) > self._limits.max_question_chars:
            raise AppError(
                ErrorCode.QUESTION_TOO_LONG, params={"max": self._limits.max_question_chars}
            )
        return question

    def _model(self, model: str | None) -> str:
        model = model or self._limits.default_model
        if model not in self._limits.enabled_models or model not in MODEL_PROFILES:
            raise AppError(ErrorCode.MODEL_NOT_ALLOWED, params={"model": model})
        models = self._deps.models
        if not models.is_available(model):
            params = {"model": model}
            if fallback := models.fallback(model):
                params["fallback"] = fallback
            raise AppError(ErrorCode.MODEL_UNAVAILABLE, params=params)
        return model

    def _chat(self, chat_id: str) -> Chat:
        chat = self._chats.get_chat(chat_id)
        if chat is None:
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        return chat

    def _check_budget(self) -> None:
        if self._budget is not None:
            self._budget.check()

    def _count_request(self) -> None:
        """Last of all checks: a question refused for another reason never uses up the limit."""
        if self._rate is not None:
            self._rate.acquire()

    def _message_room(self, chat_id: str, adding: int) -> None:
        count = self._chats.count_messages(chat_id)
        if count + adding > self._limits.max_messages_per_chat:
            raise AppError(
                ErrorCode.MESSAGE_LIMIT, params={"max": self._limits.max_messages_per_chat}
            )

    # Use cases

    async def ask(self, command: AskCommand) -> AnswerRun:
        """Checks, saves the question and starts the run. Raises AppError before any stream."""
        return await self._prepared(functools.partial(self._prepare_ask, command))

    async def regenerate(
        self, chat_id: str, assistant_id: str, options: AnswerOptions
    ) -> AnswerRun:
        """Replaces an answer to the latest question, in the same lane and row."""
        return await self._prepared(
            functools.partial(self._prepare_regenerate, chat_id, assistant_id, options)
        )

    async def _prepared(self, prepare: Callable[[], tuple[RunInput, RunControl]]) -> AnswerRun:
        """Runs the checks in a worker thread. If the request is cancelled meanwhile, a run
        that was already reserved still starts and ends at once as `interrupted`, so neither
        the lane nor the placeholder stays taken."""
        work = asyncio.ensure_future(asyncio.to_thread(prepare))
        try:
            spec, control = await asyncio.shield(work)
        except asyncio.CancelledError:
            work.add_done_callback(self._abandon)
            raise
        return self._start(spec, control)

    def _abandon(self, work: "asyncio.Future[tuple[RunInput, RunControl]]") -> None:
        if work.cancelled() or work.exception() is not None:
            return
        spec, control = work.result()
        self._start(spec, control)
        control.request_stop(StopReason.INTERRUPTED)

    def _start(self, spec: RunInput, control: RunControl) -> AnswerRun:
        run = AnswerRun(self._deps, spec, control)
        run.start()
        log.info(
            "answer_started",
            extra={
                "chat_id": spec.chat.id,
                "message_id": spec.answer.id,
                "lane": control.lane.value,
                "model": spec.answer.model,
                "sources_mode": spec.plan.mode.value,
                "history_turns": len(spec.history),
                "question_chars": len(spec.question.content),
            },
        )
        return run

    def _prepare_ask(self, command: AskCommand) -> tuple[RunInput, RunControl]:
        question_text = self._question(command.content)
        options = replace(command.options, model=self._model(command.options.model))
        chat = self._chat(command.chat_id)
        existing = self._chats.find_user_message(chat.id, command.client_message_id)
        if existing is not None and (
            command.comparison_id is None
            or self._chats.answer_in_lane(existing.id, command.lane) is not None
        ):
            raise AppError(ErrorCode.DUPLICATE_REQUEST)
        self._message_room(chat.id, 1 if existing else 2)
        self._check_budget()
        plan = self._deps.retrieval.plan(chat)
        control = self._deps.registry.reserve(chat.id, command.lane)
        try:
            self._count_request()
            earlier = self._chats.list_messages(chat.id)
            if existing is not None:
                earlier = [m for m in earlier if m.created_at < existing.created_at]
            now = self._deps.clock.now()
            question = existing or Message(
                id=str(uuid.uuid4()),
                chat_id=chat.id,
                role=MessageRole.USER,
                created_at=now,
                content=question_text,
                client_message_id=command.client_message_id,
            )
            answer = self._placeholder(chat, question, options, command.lane)
            answer = replace(
                answer, comparison_id=command.comparison_id, is_preferred=command.lane is Lane.A
            )
            # Question and placeholder together: a failed placeholder must not leave the
            # question behind, or a retry with the same client_message_id is a duplicate.
            self._chats.insert_messages([answer] if existing else [question, answer])
            if existing is None:
                chat = self._touch(chat, question_text)
            spec = self._spec(chat, question, answer, earlier, plan, options)
            return spec, control
        except DuplicateMessage as exc:
            self._deps.registry.release(control)
            raise AppError(ErrorCode.DUPLICATE_REQUEST) from exc
        except BaseException:
            self._deps.registry.release(control)
            raise

    def _prepare_regenerate(
        self, chat_id: str, assistant_id: str, options: AnswerOptions
    ) -> tuple[RunInput, RunControl]:
        chat = self._chat(chat_id)
        answer = self._chats.get_message(assistant_id)
        if answer is None or answer.chat_id != chat.id or answer.role is not MessageRole.ASSISTANT:
            raise AppError(ErrorCode.NOT_FOUND)
        if options.model is None:  # keep the answer's model unless another one is chosen
            previous = answer.model if answer.model in MODEL_PROFILES else None
            options = replace(options, model=previous)
        options = replace(options, model=self._model(options.model))
        messages = self._chats.list_messages(chat.id)
        questions = [m for m in messages if m.role is MessageRole.USER]
        if not questions or questions[-1].id != answer.parent_id:
            raise AppError(ErrorCode.MESSAGE_NOT_LATEST)
        question = questions[-1]
        self._check_budget()
        plan = self._deps.retrieval.plan(chat)
        lane = answer.lane or Lane.A
        control = self._deps.registry.reserve(chat.id, lane)
        try:
            self._count_request()
            fresh = self._placeholder(chat, question, options, lane)
            answer = replace(
                fresh,
                id=answer.id,
                created_at=answer.created_at,
                comparison_id=answer.comparison_id,
                is_preferred=answer.is_preferred,
            )
            self._chats.save_message(answer)
            earlier = [m for m in messages if m.created_at < question.created_at]
            return self._spec(chat, question, answer, earlier, plan, options), control
        except BaseException:
            self._deps.registry.release(control)
            raise

    # Helpers

    def _touch(self, chat: Chat, question: str) -> Chat:
        """New activity moves the chat up; the first question names it (never a user title)."""
        self._chats.touch_chat(
            chat.id, self._deps.clock.now(), auto_title=title_from_question(question) or None
        )
        return self._chats.get_chat(chat.id) or chat

    def _placeholder(
        self, chat: Chat, question: Message, options: AnswerOptions, lane: Lane
    ) -> Message:
        model = options.model or self._limits.default_model
        profile = MODEL_PROFILES[model]
        return Message(
            id=str(uuid.uuid4()),
            chat_id=chat.id,
            role=MessageRole.ASSISTANT,
            created_at=self._deps.clock.now(),
            status=MessageStatus.STREAMING,
            parent_id=question.id,
            model=model,
            effort=resolve_effort(profile, options.effort),
            lane=lane,
        )

    def _spec(
        self,
        chat: Chat,
        question: Message,
        answer: Message,
        earlier: list[Message],
        plan: RetrievalPlan,
        options: AnswerOptions,
    ) -> RunInput:
        history = build_history(
            earlier,
            max_turns=self._limits.history_max_turns,
            max_tokens=self._limits.history_max_tokens,
        )
        previous = history[-1].question if history else None
        return RunInput(
            chat=chat,
            question=question,
            answer=answer,
            plan=plan,
            query=follow_up_query(previous, question.content),
            history=history,
            effort=answer.effort,
            style=options.style,
            locale=options.locale,
            max_tokens=self._limits.max_output_tokens,
            allow_fallbacks=answer.comparison_id is None,
        )
