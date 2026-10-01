"""Checks a Claude API key with a free call that takes the same path as every answer: counting
the tokens of a tiny message needs the key, its workspace and the Messages API, and costs
nothing. Listing models does not need a workspace, so it passed keys that cannot answer."""

import logging
from collections.abc import Callable
from typing import Any

import anthropic

from docchat.adapters.anthropic.client import sdk_client
from docchat.adapters.anthropic.error_mapper import error_details, needs_workspace
from docchat.domain.api_key import KeyCheck

log = logging.getLogger("docchat.llm")

_TIMEOUT = anthropic.Timeout(10.0, connect=5.0)
PROBE_MODEL = "claude-haiku-4-5"
_PROBE = [{"role": "user", "content": "."}]


def _default_sdk(key: str, workspace_id: str | None) -> Any:
    return sdk_client(key, workspace_id=workspace_id, timeout=_TIMEOUT)


class AnthropicKeyValidator:
    def __init__(self, sdk: Callable[[str, str | None], Any] = _default_sdk) -> None:
        self._sdk = sdk  # tests pass a stand-in with the same `messages.count_tokens`

    async def check(self, key: str, workspace_id: str | None = None) -> KeyCheck:
        client = self._sdk(key, workspace_id)
        try:
            await client.messages.count_tokens(model=PROBE_MODEL, messages=_PROBE)
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            return KeyCheck.INVALID
        except anthropic.NotFoundError:
            return KeyCheck.VALID  # the key passed; only the probe model is gone
        except anthropic.APIStatusError as exc:
            if needs_workspace(exc):
                return KeyCheck.NEEDS_WORKSPACE
            # Rate limit, outage or a request we got wrong: the key may be fine.
            log.warning("api_key_check_unreachable", extra=error_details(exc))
            return KeyCheck.UNREACHABLE
        except anthropic.APIConnectionError as exc:
            log.warning("api_key_check_unreachable", extra=error_details(exc))
            return KeyCheck.UNREACHABLE
        finally:
            await client.close()
        return KeyCheck.VALID
