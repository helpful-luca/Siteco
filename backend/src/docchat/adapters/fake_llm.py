"""A deterministic stand-in for Claude (`LLM_PROVIDER=fake`).

It answers with one sentence of the first search result and cites it, so E2E tests and a demo
without a key run through the real retrieval, SSE, citations and persistence. Scenarios for
error paths come from a script (tests) or a `#fake:<scenario>` marker in the question (E2E).
"""

import asyncio
import re
from collections.abc import AsyncIterator, Sequence
from enum import StrEnum

from docchat.domain.enums import Locale
from docchat.domain.errors import ErrorCode
from docchat.domain.history import estimate_tokens
from docchat.domain.llm import (
    CitationDelta,
    Completed,
    LLMError,
    LLMEvent,
    LLMRequest,
    ModelResolved,
    RequestStarted,
    TextBlockEnd,
    TextDelta,
    UsageReported,
)
from docchat.domain.usage import ModelUsage, TokenUsage


class FakeScenario(StrEnum):
    NORMAL = "normal"  # cites the first sentence of the first source
    OVERLOADED = "overloaded"  # overloaded_error before the first token
    ERROR_MID_STREAM = "error_mid_stream"  # overloaded_error after some text
    REFUSAL = "refusal"  # stop_reason refusal after some text
    MAX_TOKENS = "max_tokens"  # stop_reason max_tokens
    SLOW = "slow"  # many small deltas with a pause each, for stop tests
    FALLBACK = "fallback"  # server-side fallback to another model mid-stream
    EMPTY = "empty"  # end_turn without any text
    NO_CITATIONS = "no_citations"  # an answer without citations


_MARKER = re.compile(r"#fake:([a-z_]+)")
_INTRO = {Locale.DE: "Laut deinen Dokumenten: ", Locale.EN: "According to your documents: "}
_NOTHING = {
    Locale.DE: "Dazu habe ich in deinen Dokumenten nichts gefunden.",
    Locale.EN: "I could not find anything about this in your documents.",
}
_FALLBACK_MODEL = {"claude-sonnet-5-5": "claude-sonnet-5"}


def _words(text: str) -> list[str]:
    """Splits into deltas the way a stream would, keeping every character."""
    return re.findall(r"\S+\s*|\s+", text)


class FakeLLMClient:
    def __init__(
        self,
        script: Sequence[FakeScenario] = (),
        *,
        default: FakeScenario = FakeScenario.NORMAL,
        delay_s: float = 0.0,
        slow_delay_s: float = 0.05,
    ) -> None:
        self.script = list(script)
        self.default = default
        self.delay_s = delay_s
        self.slow_delay_s = slow_delay_s
        self.requests: list[LLMRequest] = []
        self.cancelled = 0  # streams closed before they finished (stop, disconnect)

    def _scenario(self, request: LLMRequest) -> FakeScenario:
        if self.script:
            return self.script.pop(0)
        marker = _MARKER.search(request.question)
        if marker and marker.group(1) in FakeScenario:
            return FakeScenario(marker.group(1))
        return self.default

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMEvent]:
        self.requests.append(request)
        scenario = self._scenario(request)
        finished = False
        try:
            yield RequestStarted()
            async for event in self._events(request, scenario):
                await asyncio.sleep(self.slow_delay_s if scenario is FakeScenario.SLOW else 0)
                yield event
            finished = True
        finally:
            if not finished:
                self.cancelled += 1

    async def _events(self, request: LLMRequest, scenario: FakeScenario) -> AsyncIterator[LLMEvent]:
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if scenario is FakeScenario.OVERLOADED:
            raise LLMError(ErrorCode.LLM_OVERLOADED, retry_after=1)
        model = request.model
        usage = TokenUsage(
            input_tokens=estimate_tokens(
                request.question + "".join(s for r in request.search_results for s in r.sentences)
            ),
        )
        yield ModelResolved(model)
        yield UsageReported((ModelUsage(model, usage),))
        if scenario is FakeScenario.EMPTY:
            yield Completed("end_turn")
            return

        intro = _INTRO[request.ui_language]
        for word in _words(intro):
            yield TextDelta(word)
        yield TextBlockEnd()
        if scenario is FakeScenario.ERROR_MID_STREAM:
            raise LLMError(ErrorCode.LLM_OVERLOADED, retry_after=5)
        if scenario is FakeScenario.REFUSAL:
            yield Completed("refusal")
            return
        if scenario is FakeScenario.FALLBACK:
            model = _FALLBACK_MODEL.get(request.model, "claude-opus-4-8")
            yield ModelResolved(model)

        first = request.search_results[0] if request.search_results else None
        if first is None or not first.sentences:
            body = _NOTHING[request.ui_language]
        else:
            body = first.sentences[0]
        if first is not None and first.sentences and scenario is not FakeScenario.NO_CITATIONS:
            yield CitationDelta(first.source, 0, 1, first.sentences[0])
        for word in _words(body):
            yield TextDelta(word)
        yield TextBlockEnd()
        if scenario is FakeScenario.SLOW:
            for word in _words(" " + body * 20):
                yield TextDelta(word)
            yield TextBlockEnd()

        answer_tokens = estimate_tokens(intro + body)
        served = ModelUsage(model, TokenUsage(usage.input_tokens, answer_tokens))
        parts: tuple[ModelUsage, ...] = (served,)
        if model != request.model:
            parts = (ModelUsage(request.model, TokenUsage(usage.input_tokens, 3)), *parts)
        yield UsageReported(parts)
        yield Completed("max_tokens" if scenario is FakeScenario.MAX_TOKENS else "end_turn")
