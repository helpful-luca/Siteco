"""A deterministic stand-in for Claude (`LLM_PROVIDER=fake`).

It answers with the first real sentence of the search results and cites it, so E2E tests and a demo
without a key run through the real retrieval, SSE, citations and persistence. Scenarios for
error paths come from a script (tests) or a `#fake:<scenario>` marker in the question (E2E);
`#fake:<scenario>@<model>` applies to that model only, so one lane of a comparison can fail.
"""

import asyncio
import re
from collections.abc import AsyncIterator, Sequence
from enum import StrEnum

from docchat.domain.enums import Locale
from docchat.domain.errors import ErrorCode
from docchat.domain.exact_terms import is_rare, query_terms
from docchat.domain.history import estimate_tokens
from docchat.domain.llm import (
    CitationDelta,
    Completed,
    LLMError,
    LLMEvent,
    LLMRequest,
    ModelResolved,
    RequestStarted,
    SearchResult,
    TextBlockEnd,
    TextDelta,
    UsageReported,
)
from docchat.domain.page_reference import find_page_request
from docchat.domain.usage import ModelUsage, TokenUsage


class FakeScenario(StrEnum):
    NORMAL = "normal"  # cites the first real sentence of the search results
    OVERLOADED = "overloaded"  # overloaded_error before the first token
    ERROR_MID_STREAM = "error_mid_stream"  # overloaded_error after some text
    REFUSAL = "refusal"  # stop_reason refusal after some text
    MAX_TOKENS = "max_tokens"  # stop_reason max_tokens
    SLOW = "slow"  # many small deltas with a pause each, for stop tests
    FALLBACK = "fallback"  # server-side fallback to another model mid-stream
    EMPTY = "empty"  # end_turn without any text
    NO_CITATIONS = "no_citations"  # an answer without citations
    HANG = "hang"  # never sends a token (first-token timeout)
    # Claude's errors before the first token, one per code (annex 10, H1 to H11)
    AUTH = "auth"
    BILLING = "billing"
    FORBIDDEN = "forbidden"
    MODEL_NOT_FOUND = "model_not_found"
    RATE_LIMITED = "rate_limited"
    UNAVAILABLE = "unavailable"
    UNREACHABLE = "unreachable"
    BAD_REQUEST = "bad_request"
    CONTEXT_TOO_LARGE = "context_too_large"


_MIN_ANSWER_WORDS = 4
_SENTENCE_ENDS = (".", "!", "?", ":", ";", ")", '"', "\u201c")
_MARKER = re.compile(r"#fake:([a-z_]+)(?:@([a-z0-9.-]+))?")
_INTRO = {Locale.DE: "Laut deinen Dokumenten: ", Locale.EN: "According to your documents: "}
_NOTHING = {
    Locale.DE: "Dazu habe ich in deinen Dokumenten nichts gefunden.",
    Locale.EN: "I could not find anything about this in your documents.",
}
_FALLBACK_MODEL = {"claude-sonnet-5-5": "claude-sonnet-5"}
_ERRORS: dict[FakeScenario, tuple[ErrorCode, int | None]] = {
    FakeScenario.AUTH: (ErrorCode.LLM_AUTH, None),
    FakeScenario.BILLING: (ErrorCode.LLM_BILLING, None),
    FakeScenario.FORBIDDEN: (ErrorCode.LLM_FORBIDDEN, None),
    FakeScenario.MODEL_NOT_FOUND: (ErrorCode.MODEL_UNAVAILABLE, None),
    FakeScenario.RATE_LIMITED: (ErrorCode.LLM_RATE_LIMITED, 30),
    FakeScenario.UNAVAILABLE: (ErrorCode.LLM_UNAVAILABLE, None),
    FakeScenario.UNREACHABLE: (ErrorCode.LLM_UNREACHABLE, None),
    FakeScenario.BAD_REQUEST: (ErrorCode.LLM_BAD_REQUEST, None),
    FakeScenario.CONTEXT_TOO_LARGE: (ErrorCode.LLM_CONTEXT_TOO_LARGE, None),
}


def _words(text: str) -> list[str]:
    """Splits into deltas the way a stream would, keeping every character."""
    return re.findall(r"\S+\s*|\s+", text)


def _is_sentence(text: str, *, strict: bool) -> bool:
    """Reads like an answer: enough words, no markdown heading or table row, and (strict)
    ends like a sentence. A heading can be long ("## Technische Daten der Mira L")."""
    stripped = text.strip()
    if len(stripped.split()) < _MIN_ANSWER_WORDS or stripped.startswith(("#", "|", "---")):
        return False
    return not strict or stripped.endswith(_SENTENCE_ENDS)


def _citable(results: Sequence[SearchResult]) -> tuple[SearchResult, int] | None:
    """The first real sentence across the results, else the first sentence at all."""
    for strict in (True, False):
        for result in results:
            for index, sentence in enumerate(result.sentences):
                if _is_sentence(sentence, strict=strict):
                    return result, index
    first = next((r for r in results if r.sentences), None)
    return (first, 0) if first is not None else None


def _on_page(result: SearchResult, pages: Sequence[int]) -> bool:
    return any(result.title.endswith(f", S. {page}") for page in pages)


def _term_score(sentence: str, terms: Sequence[str]) -> float:
    lowered = sentence.lower()
    return sum(lowered.count(t) * (2.0 if is_rare(t) else 1.0) for t in terms)


def _most_relevant(request: LLMRequest) -> tuple[SearchResult, int] | None:
    """What a model would cite: the page that was asked, else the sentence with the most of the
    question's words (rare words and codes count double), else the first real sentence. The demo
    thereby shows what retrieval delivers, not just the first source."""
    results = request.search_results
    if request.requested_pages or find_page_request(request.question):
        pages = request.requested_pages or find_page_request(request.question).pages  # type: ignore[union-attr]
        on_page = [r for r in results if _on_page(r, pages)]
        if pick := _citable(on_page):
            return pick
    terms = query_terms(request.question)
    best: tuple[float, SearchResult, int] | None = None
    for result in results:
        for index, sentence in enumerate(result.sentences):
            score = _term_score(sentence, terms)
            if score and _is_sentence(sentence, strict=True):
                score += 0.5  # a full sentence reads better than a table row with the term
            if score and (best is None or score > best[0]):
                best = (score, result, index)
    if best is not None:
        return best[1], best[2]
    return _citable(results)


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
        for name, model in _MARKER.findall(request.question):
            if name in FakeScenario and model in ("", request.model):
                return FakeScenario(name)
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
        if scenario in _ERRORS:
            code, retry_after = _ERRORS[scenario]
            raise LLMError(
                code, retry_after=retry_after, model_gone=scenario is FakeScenario.MODEL_NOT_FOUND
            )
        if scenario is FakeScenario.HANG:
            await asyncio.sleep(3600)
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

        pick = _most_relevant(request)
        if pick is None:
            body = _NOTHING[request.ui_language]
        else:
            result, cited = pick
            body = result.sentences[cited]
            if scenario is not FakeScenario.NO_CITATIONS:
                yield CitationDelta(result.source, cited, cited + 1, body)
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
