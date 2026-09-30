from typing import Any

import pytest

from docchat.adapters.anthropic.request_builder import FALLBACK_BETA, build_request
from docchat.domain.enums import AnswerStyle, Effort, Locale
from docchat.domain.history import HistoryTurn
from docchat.domain.llm import LLMRequest, SearchResult
from docchat.domain.model_profiles import MODEL_PROFILES
from docchat.domain.prompt import SYSTEM_PROMPT

FORBIDDEN = {"temperature", "top_p", "top_k"}


def request(model: str, **changes: Any) -> LLMRequest:
    base: dict[str, Any] = {
        "model": model,
        "effort": None,
        "history": (HistoryTurn("Frage 1", "Antwort 1"), HistoryTurn("Frage 2", "Antwort 2")),
        "search_results": (
            SearchResult("k1", "Datenblatt.pdf, S. 2", ("Satz eins.", "Satz zwei.")),
        ),
        "question": "Welche Schutzart?",
        "ui_language": Locale.DE,
        "answer_style": AnswerStyle.CONCISE,
        "max_tokens": 4096,
    }
    return LLMRequest(**(base | changes))


def build(model: str, **changes: Any) -> dict[str, Any]:
    return build_request(request(model, **changes), MODEL_PROFILES[model])


@pytest.mark.parametrize("model", list(MODEL_PROFILES))
def test_no_model_gets_sampling_parameters_or_disabled_thinking(model: str) -> None:
    body = build(model)
    assert not FORBIDDEN & set(body)
    assert body.get("thinking", {}).get("type") != "disabled"
    assert body["model"] == model and body["max_tokens"] == 4096


def test_sonnet_shape_with_effort_and_fallbacks() -> None:
    body = build("claude-sonnet-5-5", effort=Effort.MEDIUM)
    assert body["output_config"] == {"effort": "medium"}
    assert "thinking" not in body  # adaptive is the default
    assert body["fallbacks"] == "default"
    assert body["betas"] == [FALLBACK_BETA]


def test_opus_defaults_to_low_effort_and_never_sends_thinking() -> None:
    body = build("claude-opus-5-5")
    assert body["output_config"] == {"effort": "low"}
    assert "thinking" not in body


def test_haiku_gets_neither_effort_nor_thinking_nor_fallbacks() -> None:
    body = build("claude-haiku-4-5", effort=Effort.HIGH)
    assert {"output_config", "thinking", "fallbacks", "betas"}.isdisjoint(body)


def test_compare_lanes_switch_fallbacks_off() -> None:
    body = build("claude-sonnet-5-5", allow_fallbacks=False)
    assert "fallbacks" not in body and "betas" not in body


def test_between_tools_only_for_sonnet() -> None:
    sonnet = build_request(
        request("claude-sonnet-5-5"),
        MODEL_PROFILES["claude-sonnet-5-5"],
        sonnet_thinking="between_tools",
    )
    opus = build_request(
        request("claude-opus-5-5"),
        MODEL_PROFILES["claude-opus-5-5"],
        sonnet_thinking="between_tools",
    )
    assert sonnet["thinking"] == {"type": "between_tools"}
    assert "thinking" not in opus


def test_cache_breakpoints_on_system_prompt_and_last_answer() -> None:
    body = build("claude-sonnet-5-5")
    assert body["system"] == [
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}
    ]
    messages = body["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant", "user"]
    assert "cache_control" not in messages[1]["content"][0]
    assert messages[3]["content"][0]["cache_control"] == {"type": "ephemeral"}
    marked = [b for m in messages for b in m["content"] if "cache_control" in b]
    assert len(marked) == 1


def test_current_turn_has_search_results_then_context_then_question() -> None:
    last = build("claude-sonnet-5-5")["messages"][-1]
    result, context, question = last["content"]
    assert result == {
        "type": "search_result",
        "source": "k1",
        "title": "Datenblatt.pdf, S. 2",
        "content": [{"type": "text", "text": "Satz eins."}, {"type": "text", "text": "Satz zwei."}],
        "citations": {"enabled": True},
    }
    assert context["text"] == "<turn_context>ui_language: de; answer_style: concise</turn_context>"
    assert question == {"type": "text", "text": "Welche Schutzart?"}


def test_history_is_plain_text_without_search_results() -> None:
    messages = build("claude-sonnet-5-5")["messages"][:-1]
    blocks = [b for m in messages for b in m["content"]]
    assert all(b["type"] == "text" for b in blocks)


def test_without_history_there_is_only_the_current_turn() -> None:
    body = build("claude-sonnet-5-5", history=())
    assert len(body["messages"]) == 1
