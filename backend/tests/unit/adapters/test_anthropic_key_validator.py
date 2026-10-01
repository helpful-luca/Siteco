"""The key check takes the same path as answers (token counting), against a stand-in SDK."""

from typing import Any

import anthropic
import pytest

from docchat.adapters.anthropic.key_validator import PROBE_MODEL, AnthropicKeyValidator
from docchat.domain.api_key import KeyCheck
from tests.unit.adapters.test_anthropic_client import REQUEST, status_error

WORKSPACE = (
    "This API key is not scoped to a workspace, so this request must include the "
    "anthropic-workspace-id header."
)


class FakeCounter:
    def __init__(self, outcome: Exception | None) -> None:
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []
        self.closed = False
        self.messages = self

    async def count_tokens(self, **body: Any) -> object:
        self.calls.append(body)
        if self.outcome is not None:
            raise self.outcome
        return object()

    async def close(self) -> None:
        self.closed = True


def validator(outcome: Exception | None) -> tuple[AnthropicKeyValidator, FakeCounter, list[Any]]:
    sdk, made = FakeCounter(outcome), []

    def factory(key: str, workspace_id: str | None) -> FakeCounter:
        made.append((key, workspace_id))
        return sdk

    return AnthropicKeyValidator(factory), sdk, made


@pytest.mark.parametrize(
    ("outcome", "verdict"),
    [
        (None, KeyCheck.VALID),
        (status_error(401, "authentication_error", "invalid x-api-key"), KeyCheck.INVALID),
        (status_error(403, "permission_error", "no"), KeyCheck.INVALID),
        (status_error(400, "invalid_request_error", WORKSPACE), KeyCheck.NEEDS_WORKSPACE),
        (status_error(404, "not_found_error", "model"), KeyCheck.VALID),
        (status_error(429, "rate_limit_error", "slow"), KeyCheck.UNREACHABLE),
        (status_error(529, "overloaded_error", "busy"), KeyCheck.UNREACHABLE),
        (anthropic.APIConnectionError(request=REQUEST), KeyCheck.UNREACHABLE),
    ],
)
async def test_verdicts(outcome: Exception | None, verdict: KeyCheck) -> None:
    check, sdk, _ = validator(outcome)
    assert await check.check("sk-ant-key") is verdict
    assert sdk.calls[0]["model"] == PROBE_MODEL and sdk.closed


async def test_the_workspace_id_goes_with_the_check() -> None:
    check, _, made = validator(None)
    await check.check("sk-ant-key", "wrkspc_01X")
    assert made == [("sk-ant-key", "wrkspc_01X")]


def test_the_default_client_counts_tokens_like_answers() -> None:
    # No network: only the shape of the real client is checked.
    from docchat.adapters.anthropic.key_validator import _default_sdk

    client = _default_sdk("sk-ant-key", "wrkspc_01X")
    assert client.default_headers["anthropic-workspace-id"] == "wrkspc_01X"
    assert callable(client.messages.count_tokens)
