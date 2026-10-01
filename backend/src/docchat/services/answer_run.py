"""One answer, from retrieval to the saved message, as its own asyncio task.

The task owns the answer's life: it emits events into a queue, retries before the first
delta, and always ends with exactly one terminal event and one final save, whether the answer
completes, fails, is stopped (`stopped`) or loses its listener (`interrupted`). The SSE
response only reads the queue, so nothing depends on how a web framework finalizes a
cancelled generator.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any

from docchat.domain.chat_models import Chat, Message, SourceSnapshot
from docchat.domain.citations import AnswerAssembler
from docchat.domain.enums import (
    AnswerStyle,
    Effort,
    ErrorStage,
    Locale,
    MessageStatus,
    RunPhase,
    SourcesMode,
)
from docchat.domain.errors import ErrorCode, NoticeCode
from docchat.domain.history import HistoryTurn
from docchat.domain.llm import (
    CitationDelta,
    Completed,
    LLMError,
    LLMRequest,
    ModelResolved,
    RequestStarted,
    SearchResult,
    TextBlockEnd,
    TextDelta,
    UsageReported,
)
from docchat.domain.model_profiles import cost_usd
from docchat.domain.models import Chunk, Document, Notice
from docchat.domain.ports import ChatRepository, Clock, LLMClient, UsageLedger
from docchat.domain.retrieval import snippet
from docchat.domain.usage import ModelUsage, total_usage
from docchat.services.context_budget import ContextBudget
from docchat.services.llm_health import LlmHealth
from docchat.services.model_availability import ModelAvailability
from docchat.services.retrieval_service import RetrievalPlan, RetrievalService, Retrieved
from docchat.services.run_events import (
    CitationEvent,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    MetaEvent,
    RunEvent,
    SourcesEvent,
    StatusEvent,
)
from docchat.services.run_registry import RunControl, RunRegistry, StopReason

log = logging.getLogger("docchat.answers")

_RETRYABLE = frozenset(
    {ErrorCode.LLM_OVERLOADED, ErrorCode.LLM_UNAVAILABLE, ErrorCode.LLM_UNREACHABLE}
)


@dataclass(frozen=True)
class RunTimings:
    ttft_timeout_s: float = 60
    total_timeout_s: float = 180
    max_retries: int = 2  # retries before the first delta (attempts 2 and 3)
    retry_base_s: float = 1.0
    retry_max_wait_s: float = 10.0  # a longer `retry-after` is not waited for


@dataclass(frozen=True)
class RunDeps:
    chats: ChatRepository
    retrieval: RetrievalService
    llm: LLMClient | None
    health: LlmHealth
    ledger: UsageLedger
    clock: Clock
    registry: RunRegistry
    timings: RunTimings
    models: ModelAvailability
    budget: ContextBudget = field(default_factory=ContextBudget)
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    jitter: Callable[[], float] = lambda: 0.0  # 0..1, share of the delay added on top


@dataclass(frozen=True)
class RunInput:
    chat: Chat
    question: Message
    answer: Message  # the `streaming` placeholder this run fills
    plan: RetrievalPlan
    query: str  # search text (previous question plus current one for follow-ups)
    history: tuple[HistoryTurn, ...]
    effort: Effort | None
    style: AnswerStyle
    locale: Locale
    max_tokens: int
    allow_fallbacks: bool
    request_id: str | None = None


MAX_PAGE_SOURCES = 12  # full-context mode: chunks of the asked page shown up front


def _title(document: Document, chunk: Chunk) -> str:
    """File, heading (product or section) and, for PDFs, the page last: the system prompt
    matches asked pages at the end of the title."""
    parts = [document.filename, chunk.heading] if chunk.heading else [document.filename]
    if chunk.page is not None:
        parts.append(f"S. {chunk.page}")
    return ", ".join(parts)


def _sources(retrieved: Retrieved) -> tuple[tuple[SourceSnapshot, ...], tuple[SearchResult, ...]]:
    snapshots: list[SourceSnapshot] = []
    results: list[SearchResult] = []
    for index, chunk in enumerate(retrieved.chunks, start=1):
        document = retrieved.documents[chunk.document_id]
        snapshots.append(
            SourceSnapshot(
                id=chunk.chunk_id,
                index=index,
                document_id=chunk.document_id,
                filename=document.filename,
                page=chunk.page,
                snippet=snippet(chunk.text),
            )
        )
        results.append(SearchResult(chunk.chunk_id, _title(document, chunk), _blocks(chunk)))
    return tuple(snapshots), tuple(results)


def _blocks(chunk: Chunk) -> tuple[str, ...]:
    sentences = tuple(s.text for s in chunk.sentences if s.text.strip())
    return sentences or (chunk.text,)


class AnswerRun:
    def __init__(self, deps: RunDeps, spec: RunInput, control: RunControl) -> None:
        self._deps = deps
        self._spec = spec
        self._control = control
        self._queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        self._loop = asyncio.get_running_loop()
        self._started = self._loop.time()
        self._closed = False
        # Progress so far, read when the run is stopped or fails midway.
        self._sources: tuple[SourceSnapshot, ...] = ()
        # Full-context mode sends every chunk to the model but only shows (and saves) the
        # asked page's chunks and the cited ones; `_catalog` resolves a citation to its source.
        self._catalog: dict[str, SourceSnapshot] = {}
        self._known: frozenset[str] = frozenset()
        self._mode: SourcesMode | None = None
        self._notices: list[Notice] = []
        self._assembler = AnswerAssembler(())
        self._parts: tuple[ModelUsage, ...] = ()
        self._served = spec.answer.model or ""
        self._got_delta = False
        self._ttft_ms: int | None = None

    @property
    def meta(self) -> MetaEvent:
        return MetaEvent(
            chat_id=self._spec.chat.id,
            user_message_id=self._spec.question.id,
            assistant_message_id=self._spec.answer.id,
            model=self._requested,
            lane=self._control.lane,
            comparison_id=self._spec.answer.comparison_id,
        )

    @property
    def _requested(self) -> str:
        return self._spec.answer.model or ""

    def start(self) -> None:
        self._control.task = asyncio.create_task(self._execute())

    async def events(self) -> AsyncGenerator[RunEvent]:
        """The run's events up to and including the terminal one. If the listener goes away
        before that, the answer is stopped as `interrupted` and saved."""
        try:
            while (event := await self._queue.get()) is not None:
                yield event
        finally:
            if not self._closed:
                self._control.request_stop(StopReason.INTERRUPTED)

    def _emit(self, event: RunEvent) -> None:
        self._queue.put_nowait(event)

    def _elapsed_ms(self) -> int:
        return round((self._loop.time() - self._started) * 1000)

    # Task

    async def _execute(self) -> None:
        self._control.started = True
        self._emit(self.meta)  # always first, even for a run stopped before it began (S3)
        try:
            if self._control.stop_reason is not None:
                final, terminal = self._stopped()  # stopped before it could begin
            else:
                final, terminal = await self._outcome()
            self._control.finalizing = True
            terminal = await self._save(final, terminal)
            self._emit(terminal)
            self._log_finished(final, terminal)
        finally:
            self._deps.registry.release(self._control)
            self._closed = True
            self._queue.put_nowait(None)

    async def _outcome(self) -> tuple[Message, RunEvent]:
        try:
            return await self._run()
        except asyncio.CancelledError:
            task = asyncio.current_task()
            if task is not None:
                task.uncancel()
            return self._stopped()
        except Exception:
            log.exception("answer_failed", extra=self._log_fields())
            return self._failed(ErrorCode.INTERNAL_ERROR, ErrorStage.LLM)

    async def _retrieve(self, plan: RetrievalPlan, *, reduced: bool = False) -> Retrieved:
        spec = self._spec
        retrieved = await self._deps.retrieval.retrieve(plan, spec.query, spec.question.content)
        if reduced:
            notices = (*retrieved.notices, Notice(NoticeCode.CONTEXT_REDUCED))
            retrieved = replace(retrieved, notices=notices)
        return retrieved

    def _adopt(self, retrieved: Retrieved) -> tuple[SearchResult, ...]:
        """Takes the retrieved chunks as this run's sources; returns what the model gets."""
        snapshots, results = _sources(retrieved)
        self._known = frozenset(s.id for s in snapshots)
        if retrieved.mode is SourcesMode.FULL_CONTEXT:
            self._catalog = {s.id: s for s in snapshots}
            asked = [s for s in snapshots if s.page in retrieved.requested_pages]
            shown = asked[:MAX_PAGE_SOURCES]
            self._sources = tuple(replace(s, index=n) for n, s in enumerate(shown, start=1))
        else:
            self._catalog = {}
            self._sources = snapshots
        return results

    async def _run(self) -> tuple[Message, RunEvent]:
        spec = self._spec
        self._emit(StatusEvent(RunPhase.RETRIEVING, 1))
        llm = self._deps.llm if self._deps.health.available else None
        try:
            retrieved = await self._retrieve(spec.plan)
            if retrieved.mode is SourcesMode.FULL_CONTEXT:
                fits = llm is not None and await self._fits(llm, retrieved)
                if not fits:  # too large for this model, or nothing to generate: search
                    retrieval_plan = replace(spec.plan, mode=SourcesMode.RETRIEVAL)
                    retrieved = await self._retrieve(retrieval_plan, reduced=llm is not None)
        except Exception:
            log.exception("retrieval_failed", extra=self._log_fields())
            return self._failed(ErrorCode.INTERNAL_ERROR, ErrorStage.RETRIEVAL)
        search_results = self._adopt(retrieved)
        self._mode = SourcesMode.RETRIEVAL_ONLY if llm is None else retrieved.mode
        self._notices = list(retrieved.notices)
        self._emit(SourcesEvent(self._mode, self._sources, retrieved.notices))
        if llm is None:
            return self._sources_only()
        return await self._generate(llm, search_results, retrieved)

    async def _fits(self, llm: LLMClient, retrieved: Retrieved) -> bool:
        _, results = _sources(retrieved)
        return await self._deps.budget.fits(llm, self._requested, results, self._spec.max_tokens)

    def _request(self, retrieved: Retrieved, results: tuple[SearchResult, ...]) -> LLMRequest:
        spec = self._spec
        return LLMRequest(
            model=self._requested,
            effort=spec.effort,
            history=spec.history,
            search_results=results,
            question=spec.question.content,
            ui_language=spec.locale,
            answer_style=spec.style,
            max_tokens=spec.max_tokens,
            allow_fallbacks=spec.allow_fallbacks,
            requested_pages=retrieved.requested_pages,
            documents_first=retrieved.mode is SourcesMode.FULL_CONTEXT,
        )

    async def _generate(
        self, llm: LLMClient, search_results: tuple[SearchResult, ...], retrieved: Retrieved
    ) -> tuple[Message, RunEvent]:
        request = self._request(retrieved, search_results)
        timings = self._deps.timings
        deadline = self._started + timings.total_timeout_s
        attempt = 1
        self._emit(StatusEvent(RunPhase.GENERATING, attempt))
        while True:
            try:
                stop_reason = await self._attempt(llm, request, deadline)
                break
            except LLMError as error:
                if self._too_large_for_full_context(error, request):
                    try:
                        retrieval_plan = replace(self._spec.plan, mode=SourcesMode.RETRIEVAL)
                        retrieved = await self._retrieve(retrieval_plan, reduced=True)
                    except Exception:
                        log.exception("retrieval_failed", extra=self._log_fields())
                        return self._failed(ErrorCode.INTERNAL_ERROR, ErrorStage.RETRIEVAL)
                    request = self._request(retrieved, self._adopt(retrieved))
                    self._mode = retrieved.mode
                    self._notices = list(retrieved.notices)
                    attempt += 1
                    self._emit(SourcesEvent(self._mode, self._sources, retrieved.notices))
                    self._emit(StatusEvent(RunPhase.RETRYING, attempt))
                    continue
                delay = self._retry_delay(error, attempt, deadline)
                if delay is None:
                    return self._llm_failed(error)
                attempt += 1
                log.info(
                    "llm_retry",
                    extra={**self._log_fields(), "attempt": attempt, "code": error.code.value},
                )
                self._emit(StatusEvent(RunPhase.RETRYING, attempt))
                await self._deps.sleep(delay)
        self._deps.health.mark_ok()
        return self._completed(stop_reason)

    def _too_large_for_full_context(self, error: LLMError, request: LLMRequest) -> bool:
        """The model refused the complete documents before any text: search instead."""
        return (
            error.code is ErrorCode.LLM_CONTEXT_TOO_LARGE
            and request.documents_first
            and not self._got_delta
        )

    async def _attempt(self, llm: LLMClient, request: LLMRequest, deadline: float) -> str:
        self._assembler = AnswerAssembler(self._known)
        self._parts = ()
        self._served = self._requested
        stop_reason = "end_turn"
        ttft = self._deps.timings.ttft_timeout_s
        try:
            # Until the request is sent (a free slot) only the total limit applies.
            async with asyncio.timeout_at(deadline) as limit:
                async for event in llm.stream(request):
                    if isinstance(event, RequestStarted):
                        if not self._got_delta:
                            limit.reschedule(min(self._loop.time() + ttft, deadline))
                    elif isinstance(event, TextDelta):
                        if not self._got_delta:
                            self._got_delta = True
                            self._ttft_ms = self._elapsed_ms()
                            limit.reschedule(deadline)
                        self._assembler.add_text(event.text)
                        self._emit(DeltaEvent(event.text))
                    elif isinstance(event, CitationDelta):
                        self._assembler.add_citation(event)
                    elif isinstance(event, TextBlockEnd):
                        self._emit_citations()
                    elif isinstance(event, ModelResolved):
                        self._served = event.model
                    elif isinstance(event, UsageReported):
                        self._parts = event.parts
                    elif isinstance(event, Completed):
                        stop_reason = event.stop_reason
        except TimeoutError as exc:
            raise LLMError(ErrorCode.LLM_TIMEOUT) from exc
        return stop_reason

    def _emit_citations(self) -> None:
        for citation in self._assembler.end_block():
            self._register_cited(citation.source_id)
            self._emit(CitationEvent(citation))

    def _register_cited(self, source_id: str) -> None:
        """Full-context mode: a cited chunk becomes a visible, saved source when it is cited
        (the `sources` event comes before the citation that needs it)."""
        if source_id in {s.id for s in self._sources} or source_id not in self._catalog:
            return
        added = replace(self._catalog[source_id], index=len(self._sources) + 1)
        self._sources = (*self._sources, added)
        assert self._mode is not None
        self._emit(SourcesEvent(self._mode, (added,), ()))

    def _retry_delay(self, error: LLMError, attempt: int, deadline: float) -> float | None:
        """Seconds to wait before the next attempt, or None if this error is final."""
        timings = self._deps.timings
        if self._got_delta or attempt > timings.max_retries:
            return None  # never after the first delta: no doubled or mixed text
        retryable = error.code in _RETRYABLE or (
            error.code is ErrorCode.LLM_RATE_LIMITED
            and (error.retry_after or 0) <= timings.retry_max_wait_s
        )
        if not retryable:
            return None
        base = error.retry_after or timings.retry_base_s * 2 ** (attempt - 1)
        delay = min(float(base), timings.retry_max_wait_s)
        delay += delay * 0.25 * self._deps.jitter()
        if self._loop.time() + delay >= deadline:
            return None
        return delay

    # Outcomes: the final message and the terminal event

    def _final(self, status: MessageStatus, **changes: Any) -> Message:
        parts = self._parts
        fields: dict[str, Any] = {
            "content": self._assembler.text,
            "status": status,
            "model": self._served or self._requested,
            "sources": self._sources,
            "sources_mode": self._mode,
            "citations": self._assembler.citations,
            "notices": tuple(self._notices),
            "usage": total_usage(parts) if parts else None,
            "cost_usd": cost_usd(parts, requested_model=self._requested) if parts else 0.0,
            "ttft_ms": self._ttft_ms,
            "total_ms": self._elapsed_ms(),
        }
        return replace(self._spec.answer, **(fields | changes))

    def _done(self, message: Message, stop_reason: str | None, notices: list[Notice]) -> DoneEvent:
        return DoneEvent(
            status=message.status,
            stop_reason=stop_reason,
            usage=message.usage,
            cost_usd=message.cost_usd or 0.0,
            ttft_ms=message.ttft_ms,
            total_ms=message.total_ms or 0,
            notices=tuple(notices),
            chat=self._spec.chat,
        )

    def _switch_notice(self) -> list[Notice]:
        if self._served and self._served != self._requested:
            switch = {"old": self._requested, "new": self._served}
            return [Notice(NoticeCode.MODEL_SWITCHED, switch)]
        return []

    def _completed(self, stop_reason: str) -> tuple[Message, RunEvent]:
        self._emit_citations()  # a block the stream never closed
        done_notices = self._switch_notice()
        if stop_reason == "refusal":
            # Mid-stream refusal output is not an answer: the partial text is discarded (S9).
            done_notices.append(Notice(NoticeCode.LLM_REFUSED))
            self._notices += done_notices
            self._assembler = AnswerAssembler(())
            final = self._final(MessageStatus.REFUSED)
            return final, self._done(final, stop_reason, done_notices)
        if not self._assembler.text.strip():
            return self._llm_failed(LLMError(ErrorCode.LLM_EMPTY_ANSWER))
        status = MessageStatus.COMPLETE
        if stop_reason == "max_tokens":
            status = MessageStatus.TRUNCATED
            done_notices.append(Notice(NoticeCode.ANSWER_TRUNCATED))
        if not self._assembler.citations:
            done_notices.append(Notice(NoticeCode.NO_CITATIONS))
        self._notices += done_notices
        final = self._final(status)
        return final, self._done(final, stop_reason, done_notices)

    def _sources_only(self) -> tuple[Message, RunEvent]:
        notices = [Notice(NoticeCode.LLM_NOT_CONFIGURED)]
        self._notices += notices
        final = self._final(MessageStatus.SOURCES_ONLY, model=None)
        return final, self._done(final, None, notices)

    def _stopped(self) -> tuple[Message, RunEvent]:
        self._emit_citations()
        reason = self._control.stop_reason or StopReason.INTERRUPTED
        status = MessageStatus.INTERRUPTED
        if reason is StopReason.STOPPED:
            status = MessageStatus.STOPPED
        notices = self._switch_notice()
        self._notices += notices
        final = self._final(status)
        return final, self._done(final, None, notices)

    def _failed(
        self, code: ErrorCode, stage: ErrorStage, **fields: Any
    ) -> tuple[Message, RunEvent]:
        final = self._final(
            MessageStatus.ERROR, error_code=code, error_request_id=self._spec.request_id
        )
        event = ErrorEvent(code=code, partial=self._got_delta, stage=stage, **fields)
        return final, event

    def _llm_failed(self, error: LLMError) -> tuple[Message, RunEvent]:
        if error.code is ErrorCode.LLM_AUTH:
            self._deps.health.mark_invalid()
        elif error.code is ErrorCode.LLM_KEY_NEEDS_WORKSPACE:
            self._deps.health.mark_needs_workspace()
        self._emit_citations()
        params: dict[str, Any] = {}
        if error.code is ErrorCode.MODEL_UNAVAILABLE:
            if error.model_gone:
                self._deps.models.mark_unavailable(self._requested)
            params["model"] = self._requested
            if fallback := self._deps.models.fallback(self._requested):
                params["fallback"] = fallback
        if error.retry_after is not None:
            params["seconds"] = error.retry_after
        return self._failed(
            error.code, ErrorStage.LLM, retry_after=error.retry_after, params=params
        )

    # Saving

    async def _save(self, final: Message, terminal: RunEvent) -> RunEvent:
        """Saves the answer. Only a failed save of the message itself changes the outcome;
        the usage ledger and the chat reload are extras that are logged when they fail."""
        chats = self._deps.chats
        try:
            await asyncio.to_thread(chats.save_message, final)
        except Exception:
            log.exception("answer_save_failed", extra=self._log_fields())
            await self._mark_failed_save(final)
            return ErrorEvent(
                code=ErrorCode.INTERNAL_ERROR, partial=self._got_delta, stage=ErrorStage.PERSIST
            )
        if self._parts:
            try:
                await asyncio.to_thread(self._record_usage)
            except Exception:
                log.exception("usage_record_failed", extra=self._log_fields())
        if isinstance(terminal, DoneEvent):
            try:
                chat = await asyncio.to_thread(chats.get_chat, self._spec.chat.id)
            except Exception:
                log.exception("chat_reload_failed", extra=self._log_fields())
                chat = None
            if chat is not None:
                terminal = replace(terminal, chat=chat)
        return terminal

    async def _mark_failed_save(self, final: Message) -> None:
        """One more attempt, so the row does not stay `streaming` until the next restart."""
        failed = replace(
            final,
            status=MessageStatus.ERROR,
            error_code=ErrorCode.INTERNAL_ERROR,
            error_request_id=self._spec.request_id,
        )
        try:
            await asyncio.to_thread(self._deps.chats.save_message, failed)
        except Exception:
            log.exception("answer_mark_failed", extra=self._log_fields())

    def _record_usage(self) -> None:
        usage = total_usage(self._parts)
        self._deps.ledger.record(
            self._deps.clock.now().date().isoformat(),
            cost_usd(self._parts, requested_model=self._requested),
            usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
            usage.output_tokens,
        )

    # Logs: ids, sizes and codes only, never question or answer text.

    def _log_fields(self) -> dict[str, Any]:
        return {
            "chat_id": self._spec.chat.id,
            "message_id": self._spec.answer.id,
            "lane": self._control.lane.value,
            "model": self._requested,
        }

    def _log_finished(self, final: Message, terminal: RunEvent) -> None:
        usage = final.usage
        log.info(
            "answer_finished",
            extra={
                **self._log_fields(),
                "served_model": final.model,
                "status": final.status.value,
                "code": terminal.code.value if isinstance(terminal, ErrorEvent) else None,
                "sources": len(final.sources),
                "citations": len(final.citations),
                "answer_chars": len(final.content),
                "input_tokens": usage.input_tokens if usage else None,
                "output_tokens": usage.output_tokens if usage else None,
                "cache_read_tokens": usage.cache_read_input_tokens if usage else None,
                "cost_usd": final.cost_usd,
                "ttft_ms": final.ttft_ms,
                "total_ms": final.total_ms,
            },
        )
