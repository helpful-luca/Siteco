"""Builds the Messages API body from a provider-neutral request, per model profile.

Layout (annex 11, 4.2), with two prompt cache breakpoints:
    system:   static system prompt                              <- breakpoint 1
    messages: user/assistant history as plain text
              last assistant answer                             <- breakpoint 2
              user: [search_result x k] [turn_context] [question]

Never sent: temperature, top_p, top_k, `thinking: disabled` (all 400 on these models).
"""

from typing import Any, Literal

from docchat.domain.llm import LLMRequest, SearchResult
from docchat.domain.model_profiles import ModelProfile, resolve_effort
from docchat.domain.prompt import SYSTEM_PROMPT, turn_context

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


def _messages(request: LLMRequest) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    last = len(request.history) - 1
    for i, turn in enumerate(request.history):
        answer: dict[str, Any] = {"type": "text", "text": turn.answer}
        if i == last:
            answer["cache_control"] = _CACHE
        messages.append({"role": "user", "content": [{"type": "text", "text": turn.question}]})
        messages.append({"role": "assistant", "content": [answer]})
    messages.append(
        {
            "role": "user",
            "content": [
                *(_search_result(r) for r in request.search_results),
                {"type": "text", "text": turn_context(request.ui_language, request.answer_style)},
                {"type": "text", "text": request.question},
            ],
        }
    )
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
