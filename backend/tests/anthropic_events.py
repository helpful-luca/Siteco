"""Synthetic Claude stream events in the wire format, parsed the way the SDK parses them."""

from typing import Any

from anthropic._models import construct_type
from anthropic.types.beta import BetaRawMessageStreamEvent


def parse(raw: dict[str, Any]) -> Any:
    return construct_type(type_=BetaRawMessageStreamEvent, value=raw)


def message_start(model: str = "claude-sonnet-5-5", **usage: int) -> dict[str, Any]:
    return {
        "type": "message_start",
        "message": {
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {
                "input_tokens": 412,
                "output_tokens": 1,
                "cache_read_input_tokens": 1650,
                "cache_creation_input_tokens": 0,
                **usage,
            },
        },
    }


def block_start(index: int, block_type: str = "text", **fields: Any) -> dict[str, Any]:
    block: dict[str, Any] = {"type": block_type, **fields}
    if block_type == "text":
        block = {"type": "text", "text": "", "citations": None, **fields}
    if block_type == "thinking":
        block = {"type": "thinking", "thinking": "", "signature": "", **fields}
    return {"type": "content_block_start", "index": index, "content_block": block}


def text(index: int, value: str) -> dict[str, Any]:
    return {
        "type": "content_block_delta",
        "index": index,
        "delta": {"type": "text_delta", "text": value},
    }


def citation(
    index: int, source: str, start: int = 0, end: int = 1, cited: str = "Schutzart IP66.",
    search_result_index: int = 0,
) -> dict[str, Any]:  # fmt: skip
    return {
        "type": "content_block_delta",
        "index": index,
        "delta": {
            "type": "citations_delta",
            "citation": {
                "type": "search_result_location",
                "source": source,
                "title": "Datenblatt.pdf, S. 2",
                "cited_text": cited,
                "search_result_index": search_result_index,
                "start_block_index": start,
                "end_block_index": end,
            },
        },
    }


def thinking(index: int, value: str = "") -> dict[str, Any]:
    return {
        "type": "content_block_delta",
        "index": index,
        "delta": {"type": "thinking_delta", "thinking": value},
    }


def signature(index: int) -> dict[str, Any]:
    return {
        "type": "content_block_delta",
        "index": index,
        "delta": {"type": "signature_delta", "signature": "sig"},
    }


def block_stop(index: int) -> dict[str, Any]:
    return {"type": "content_block_stop", "index": index}


def message_delta(stop_reason: str = "end_turn", **usage: Any) -> dict[str, Any]:
    return {
        "type": "message_delta",
        "delta": {"stop_reason": stop_reason, "stop_sequence": None},
        "usage": {"output_tokens": 96, **usage},
    }


def message_stop() -> dict[str, Any]:
    return {"type": "message_stop"}
