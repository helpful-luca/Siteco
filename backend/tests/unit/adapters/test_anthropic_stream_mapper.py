from typing import Any

from docchat.adapters.anthropic.stream_mapper import StreamMapper
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
from tests import anthropic_events as ev


def run(*raw: dict[str, Any], model: str = "claude-sonnet-5-5") -> list[LLMEvent]:
    mapper = StreamMapper(model)
    return [mapped for event in raw for mapped in mapper.feed(ev.parse(event))]


def test_text_and_citations_by_source() -> None:
    events = run(
        ev.message_start(),
        ev.block_start(0),
        ev.text(0, "Die Mira hat "),
        ev.block_stop(0),
        ev.block_start(1),
        ev.citation(1, "chunk-3", 0, 1, search_result_index=7),
        ev.text(1, "die Schutzart IP66."),
        ev.block_stop(1),
        ev.message_delta(),
        ev.message_stop(),
    )
    assert events[0] == ModelResolved("claude-sonnet-5-5")
    assert [e for e in events if not isinstance(e, UsageReported)][1:] == [
        TextDelta("Die Mira hat "),
        TextBlockEnd(),
        CitationDelta("chunk-3", 0, 1, "Schutzart IP66."),
        TextDelta("die Schutzart IP66."),
        TextBlockEnd(),
        Completed("end_turn"),
    ]


def test_thinking_blocks_are_ignored() -> None:
    events = run(
        ev.message_start(),
        ev.block_start(0, "thinking"),
        ev.thinking(0, "secret reasoning"),
        ev.signature(0),
        ev.block_stop(0),
        ev.block_start(1, "redacted_thinking", data="xyz"),
        ev.block_stop(1),
        ev.block_start(2),
        ev.text(2, "Antwort"),
        ev.block_stop(2),
        ev.message_delta(),
        ev.message_stop(),
    )
    texts = [e for e in events if isinstance(e, TextDelta)]
    assert texts == [TextDelta("Antwort")]
    assert events.count(TextBlockEnd()) == 1


def test_usage_is_cumulative_and_reported_early() -> None:
    events = run(ev.message_start(), ev.message_delta("max_tokens"), ev.message_stop())
    usages = [e for e in events if isinstance(e, UsageReported)]
    assert usages[0].parts == (ModelUsage("claude-sonnet-5-5", TokenUsage(412, 1, 1650, 0)),)
    assert usages[-1].parts == (ModelUsage("claude-sonnet-5-5", TokenUsage(412, 96, 1650, 0)),)
    assert events[-1] == Completed("max_tokens")


def test_refusal_stop_reason_is_passed_on() -> None:
    events = run(
        ev.message_start(),
        ev.block_start(0),
        ev.text(0, "Teil"),
        ev.block_stop(0),
        ev.message_delta("refusal"),
        ev.message_stop(),
    )
    assert events[-1] == Completed("refusal")


def test_fallback_block_switches_the_model_and_iterations_price_each_attempt() -> None:
    events = run(
        ev.message_start("claude-opus-5-5"),
        ev.block_start(0),
        ev.text(0, "Anfang "),
        ev.block_stop(0),
        ev.block_start(
            1,
            "fallback",
            **{
                "from": {"model": "claude-opus-5-5"},
                "to": {"model": "claude-opus-4-8"},
                "trigger": {"type": "refusal", "category": "cyber"},
            },
        ),
        ev.block_stop(1),
        ev.block_start(2),
        ev.text(2, "weiter"),
        ev.block_stop(2),
        ev.message_delta(
            iterations=[
                {
                    "type": "message",
                    "model": "claude-opus-5-5",
                    "input_tokens": 100,
                    "output_tokens": 5,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                },
                {
                    "type": "fallback_message",
                    "model": "claude-opus-4-8",
                    "input_tokens": 120,
                    "output_tokens": 40,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                },
            ]
        ),
        ev.message_stop(),
        model="claude-opus-5-5",
    )
    models = [e.model for e in events if isinstance(e, ModelResolved)]
    assert models == ["claude-opus-5-5", "claude-opus-4-8"]
    assert events.count(TextBlockEnd()) == 2  # the fallback block is not a text block
    final = [e for e in events if isinstance(e, UsageReported)][-1]
    assert [p.model for p in final.parts] == ["claude-opus-5-5", "claude-opus-4-8"]
    assert final.parts[1].usage.output_tokens == 40


def test_pre_output_fallback_is_visible_in_message_start() -> None:
    events = run(ev.message_start("claude-sonnet-5"), model="claude-sonnet-5-5")
    assert events[0] == ModelResolved("claude-sonnet-5")


def test_other_citation_types_are_ignored() -> None:
    raw = ev.citation(0, "x")
    raw["delta"]["citation"] = {
        "type": "char_location",
        "cited_text": "x",
        "document_index": 0,
        "document_title": None,
        "start_char_index": 0,
        "end_char_index": 1,
    }
    events = run(ev.message_start(), ev.block_start(0), raw, ev.block_stop(0))
    assert not any(isinstance(e, CitationDelta) for e in events)
