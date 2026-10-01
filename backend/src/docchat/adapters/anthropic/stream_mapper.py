"""Maps Claude's raw stream events to provider-neutral LLM events.

Text and citations come only from `text` blocks; thinking and other blocks are dropped. Citations
are matched by `source` (our chunk id), never by `search_result_index`, which counts across the
whole request.
"""

from typing import Any

from docchat.domain.llm import (
    CitationDelta,
    Completed,
    LLMEvent,
    ModelResolved,
    TextBlockEnd,
    TextDelta,
    UsageReported,
)
from docchat.domain.usage import ModelUsage, TokenUsage

_ATTEMPTS = frozenset({"message", "fallback_message"})


def _tokens(usage: Any, default: TokenUsage) -> TokenUsage:
    def pick(name: str, fallback: int) -> int:
        value = getattr(usage, name, None)
        return fallback if value is None else int(value)

    return TokenUsage(
        input_tokens=pick("input_tokens", default.input_tokens),
        output_tokens=pick("output_tokens", default.output_tokens),
        cache_read_input_tokens=pick("cache_read_input_tokens", default.cache_read_input_tokens),
        cache_creation_input_tokens=pick(
            "cache_creation_input_tokens", default.cache_creation_input_tokens
        ),
    )


def _citation(citation: Any) -> list[LLMEvent]:
    if getattr(citation, "type", None) != "search_result_location":
        return []
    return [
        CitationDelta(
            source=citation.source,
            block_start=citation.start_block_index,
            block_end=citation.end_block_index,
            cited_text=citation.cited_text,
        )
    ]


class StreamMapper:
    def __init__(self, requested_model: str) -> None:
        self._requested = requested_model
        self._model = requested_model
        self._usage = TokenUsage()
        self._iterations: list[ModelUsage] | None = None
        self._stop_reason: str | None = None
        self._blocks: dict[int, str] = {}

    def _parts(self) -> tuple[ModelUsage, ...]:
        if self._iterations:
            return tuple(self._iterations)
        return (ModelUsage(self._model, self._usage),)

    def _take_usage(self, usage: Any) -> None:
        if usage is None:
            return
        self._usage = _tokens(usage, self._usage)
        iterations = getattr(usage, "iterations", None)
        if iterations:
            self._iterations = [
                ModelUsage(getattr(it, "model", None) or self._requested, _tokens(it, TokenUsage()))
                for it in iterations
                if it.type in _ATTEMPTS
            ]

    def feed(self, event: Any) -> list[LLMEvent]:
        kind = event.type
        if kind == "message_start":
            self._model = event.message.model or self._requested
            self._take_usage(event.message.usage)
            return [ModelResolved(self._model), UsageReported(self._parts())]
        if kind == "content_block_start":
            return self._block_start(event.index, event.content_block)
        if kind == "content_block_delta":
            if self._blocks.get(event.index) != "text":
                return []  # thinking, signature and other deltas never leave the adapter
            delta = event.delta
            if delta.type == "text_delta":
                return [TextDelta(delta.text)] if delta.text else []
            if delta.type == "citations_delta":
                return _citation(delta.citation)
            return []
        if kind == "content_block_stop":
            return [TextBlockEnd()] if self._blocks.pop(event.index, None) == "text" else []
        if kind == "message_delta":
            self._stop_reason = event.delta.stop_reason or self._stop_reason
            self._take_usage(event.usage)
            return [UsageReported(self._parts())]
        if kind == "message_stop":
            return [Completed(self._stop_reason or "end_turn")]
        return []

    def _block_start(self, index: int, block: Any) -> list[LLMEvent]:
        self._blocks[index] = block.type
        if block.type == "fallback":
            self._model = block.to.model
            return [ModelResolved(self._model)]
        if block.type != "text":
            return []
        events: list[LLMEvent] = [TextDelta(block.text)] if block.text else []
        for citation in getattr(block, "citations", None) or []:
            events.extend(_citation(citation))
        return events
