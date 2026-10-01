"""Builds the Messages API body from a provider-neutral request, per model profile.

Layout (annex 11, 4.2), with two prompt cache breakpoints:
    system:   static system prompt                              <- breakpoint 1
    messages: user/assistant history as plain text
              last assistant answer                             <- breakpoint 2
              user: [search_result x k] [turn_context] [documents] [question]

Full-context mode (`documents_first`): the documents are static per scope, so they come first
and a follow-up question reads them from the cache (three breakpoints, the limit is four):
    system:   static system prompt                              <- breakpoint 1
    messages: user: [search_result x n]                         <- breakpoint 2 (last document)
                    [first question]  (or [turn_context] [documents] [question] without history)
              assistant, user, ... history as plain text
              last assistant answer                             <- breakpoint 3
              user: [turn_context] [documents] [question]

Never sent: temperature, top_p, top_k, `thinking: disabled` (all 400 on these models).
"""

from typing import Any, Literal

from docchat.domain.llm import LLMRequest, SearchResult
from docchat.domain.model_profiles import ModelProfile, resolve_effort
from docchat.domain.prompt import SYSTEM_PROMPT, documents_overview, turn_context

# `fallbacks: "default"` (scalar form) needs exactly this beta; the array form uses another.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_CACHE = {"type": "ephemeral"}

SonnetThinking = Literal["adaptive", "between_tools"]


def _search_result(result: SearchResult) -> dict[str, Any]:
    return {
        "type": "search_result",
        "source": result.source,
        "title": result.title,
        # One text block per sentence: the block is the smallest citable unit.
        "content": [{"type": "text", "text": sentence} for sentence in result.sentences],
        "citations": {"enabled": True},
    }


def _documents(request: LLMRequest) -> list[dict[str, Any]]:
    blocks = [_search_result(r) for r in request.search_results]
    if request.documents_first and blocks:
        blocks[-1]["cache_control"] = _CACHE  # everything before it is the same every turn
    return blocks


def _messages(request: LLMRequest) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    first = request.documents_first
    context = turn_context(
        request.ui_language,
        request.answer_style,
        pages=request.requested_pages,
        documents_first=first,
    )
    last = len(request.history) - 1
    for i, turn in enumerate(request.history):
        answer: dict[str, Any] = {"type": "text", "text": turn.answer}
        if i == last:
            answer["cache_control"] = _CACHE
        question: list[dict[str, Any]] = [{"type": "text", "text": turn.question}]
        messages.append(
            {
                "role": "user",
                "content": [*(_documents(request) if first and i == 0 else []), *question],
            }
        )
        messages.append({"role": "assistant", "content": [answer]})
    current: list[dict[str, Any]] = []
    if not first or not request.history:
        current += _documents(request)
    overview = documents_overview(request.documents)
    current += [
        {"type": "text", "text": context},
        *([{"type": "text", "text": overview}] if overview else []),
        {"type": "text", "text": request.question},
    ]
    messages.append({"role": "user", "content": current})
    return messages


def build_request(
    request: LLMRequest, profile: ModelProfile, *, sonnet_thinking: SonnetThinking = "adaptive"
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": profile.id,
        "max_tokens": request.max_tokens,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": _CACHE}],
        "messages": _messages(request),
    }
    effort = resolve_effort(profile, request.effort)
    if effort is not None:
        body["output_config"] = {"effort": effort.value}
    # Adaptive thinking is the default when `thinking` is omitted; `between_tools` is the
    # lowest setting and exists on Sonnet 5.5 only.
    if sonnet_thinking == "between_tools" and profile.supports_between_tools:
        body["thinking"] = {"type": "between_tools"}
    if request.allow_fallbacks and profile.supports_fallbacks:
        body["fallbacks"] = "default"
        body["betas"] = [FALLBACK_BETA]
    return body
