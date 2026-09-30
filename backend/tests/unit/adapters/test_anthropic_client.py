"""The Claude adapter against a stand-in SDK: same `beta.messages.create(stream=True)` shape,
synthetic wire events, and errors built like the SDK builds them."""

from collections.abc import AsyncIterator
from typing import Any

import anthropic
import httpx2
import pytest

from docchat.adapters.anthropic.client import AnthropicLLMClient
from docchat.adapters.anthropic.error_mapper import map_error
from docchat.domain.enums import AnswerStyle, Locale
from docchat.domain.errors import ErrorCode
from docchat.domain.llm import LLMError, LLMEvent, LLMRequest, TextDelta
from tests import anthropic_events as ev

REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def status_error(
    status: int, error_type: str, message: str = "boom", headers: dict[str, str] | None = None
) -> anthropic.APIStatusError:
    body = {
        "type": "error",
        "error": {"type": error_type, "message": message},
        "request_id": "req_up",
    }
    response = httpx2.Response(status, headers=headers or {}, request=REQUEST, json=body)
    client = anthropic.AsyncAnthropic(api_key="x")
    return client._make_status_error(message, body=body, response=response)


class FakeStream:
    def __init__(self, items: list[dict[str, Any] | Exception]) -> None:
        self.items = items
        self.closed = False

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *_: object) -> None:
        self.closed = True

    async def __aiter__(self) -> AsyncIterator[Any]:
        for item in self.items:
            if isinstance(item, Exception):
                raise item
            yield ev.parse(item)


class FakeMessages:
    def __init__(self, outcome: FakeStream | Exception) -> None:
        self.outcome = outcome
        self.bodies: list[dict[str, Any]] = []

    async def create(self, **body: Any) -> FakeStream:
        self.bodies.append(body)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeSdk:
    def __init__(self, outcome: FakeStream | Exception) -> None:
        self.beta = type("Beta", (), {})()
        self.beta.messages = FakeMessages(outcome)


def llm_request(model: str = "claude-sonnet-5-5") -> LLMRequest:
    return LLMRequest(
        model=model,
        effort=None,
        history=(),
        search_results=(),
        question="Frage",
        ui_language=Locale.DE,
        answer_style=AnswerStyle.CONCISE,
        max_tokens=4096,
    )


async def collect(client: AnthropicLLMClient, request: LLMRequest) -> list[LLMEvent]:
    return [e async for e in client.stream(request)]


async def test_streams_mapped_events_and_closes_the_stream() -> None:
    stream = FakeStream(
        [ev.message_start(), ev.block_start(0), ev.text(0, "Hallo"), ev.block_stop(0),
         ev.message_delta(), ev.message_stop()]
    )  # fmt: skip
    sdk = FakeSdk(stream)
    events = await collect(AnthropicLLMClient("key", sdk=sdk), llm_request())
    assert TextDelta("Hallo") in events
    assert stream.closed
    body = sdk.beta.messages.bodies[0]
    assert body["stream"] is True and body["fallbacks"] == "default"


async def test_overloaded_error_mid_stream_with_status_200_is_mapped_by_type() -> None:
    error = status_error(200, "overloaded_error", "Overloaded")
    assert error.status_code == 200
    stream = FakeStream([ev.message_start(), ev.block_start(0), ev.text(0, "Teil"), error])
    client = AnthropicLLMClient("key", sdk=FakeSdk(stream))
    received: list[LLMEvent] = []
    with pytest.raises(LLMError) as caught:
        async for event in client.stream(llm_request()):
            received.append(event)
    assert caught.value.code is ErrorCode.LLM_OVERLOADED
    assert caught.value.upstream_request_id == "req_up"
    assert TextDelta("Teil") in received
    assert stream.closed


async def test_error_before_the_stream_opens() -> None:
    client = AnthropicLLMClient("key", sdk=FakeSdk(status_error(401, "authentication_error")))
    with pytest.raises(LLMError) as caught:
        await collect(client, llm_request())
    assert caught.value.code is ErrorCode.LLM_AUTH


async def test_unknown_model_is_unavailable() -> None:
    client = AnthropicLLMClient("key", sdk=FakeSdk(FakeStream([])))
    with pytest.raises(LLMError) as caught:
        await collect(client, llm_request("claude-unknown"))
    assert caught.value.code is ErrorCode.MODEL_UNAVAILABLE


async def test_dropped_connection_mid_stream_is_unreachable() -> None:
    stream = FakeStream([ev.message_start(), httpx2.ReadError("reset", request=REQUEST)])
    client = AnthropicLLMClient("key", sdk=FakeSdk(stream))
    with pytest.raises(LLMError) as caught:
        await collect(client, llm_request())
    assert caught.value.code is ErrorCode.LLM_UNREACHABLE


@pytest.mark.parametrize(
    ("status", "error_type", "message", "code"),
    [
        (400, "invalid_request_error", "messages: roles must alternate", ErrorCode.LLM_BAD_REQUEST),
        (400, "invalid_request_error", "Your credit balance is too low", ErrorCode.LLM_BILLING),
        (
            400,
            "invalid_request_error",
            "prompt is too long: 1 > 0",
            ErrorCode.LLM_CONTEXT_TOO_LARGE,
        ),
        (401, "authentication_error", "invalid x-api-key", ErrorCode.LLM_AUTH),
        (402, "billing_error", "billing", ErrorCode.LLM_BILLING),
        (403, "permission_error", "no", ErrorCode.LLM_FORBIDDEN),
        (404, "not_found_error", "model: claude-x", ErrorCode.MODEL_UNAVAILABLE),
        (413, "request_too_large", "too large", ErrorCode.LLM_CONTEXT_TOO_LARGE),
        (429, "rate_limit_error", "slow down", ErrorCode.LLM_RATE_LIMITED),
        (500, "api_error", "internal", ErrorCode.LLM_UNAVAILABLE),
        (529, "overloaded_error", "overloaded", ErrorCode.LLM_OVERLOADED),
        (200, "api_error", "mid-stream", ErrorCode.LLM_UNAVAILABLE),
        (503, "something_new", "?", ErrorCode.LLM_UNAVAILABLE),
    ],
)
def test_error_mapping(status: int, error_type: str, message: str, code: ErrorCode) -> None:
    assert map_error(status_error(status, error_type, message)).code is code


def test_rate_limit_uses_the_retry_after_header() -> None:
    error = map_error(status_error(429, "rate_limit_error", headers={"retry-after": "7"}))
    assert (error.code, error.retry_after) == (ErrorCode.LLM_RATE_LIMITED, 7)
    assert map_error(status_error(429, "rate_limit_error")).retry_after == 30


def test_timeouts_and_connection_errors() -> None:
    assert map_error(anthropic.APITimeoutError(REQUEST)).code is ErrorCode.LLM_TIMEOUT
    assert (
        map_error(anthropic.APIConnectionError(request=REQUEST)).code is ErrorCode.LLM_UNREACHABLE
    )


async def test_request_started_comes_after_the_slot_is_free() -> None:
    from docchat.domain.llm import RequestStarted

    stream = FakeStream([ev.message_start(), ev.message_stop()])
    client = AnthropicLLMClient("key", sdk=FakeSdk(stream), concurrency=1)
    events = await collect(client, llm_request())
    assert events[0] == RequestStarted()


def test_only_claude_saying_not_found_error_means_the_model_is_gone() -> None:
    assert map_error(status_error(404, "not_found_error", "model: claude-x")).model_gone is True
    # A bare 404 (a proxy page, a wrong path) is no statement about the model.
    response = httpx2.Response(404, request=REQUEST, text="<html>Not Found</html>")
    bare = anthropic.AsyncAnthropic(api_key="x")._make_status_error(
        "Not Found", body=None, response=response
    )
    mapped = map_error(bare)
    assert (mapped.code, mapped.model_gone) == (ErrorCode.MODEL_UNAVAILABLE, False)
    assert map_error(status_error(529, "overloaded_error")).model_gone is False
