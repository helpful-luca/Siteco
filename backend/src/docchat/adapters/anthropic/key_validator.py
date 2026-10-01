"""Checks a Claude API key with a free call: listing one model costs nothing."""

import logging

import anthropic

from docchat.domain.api_key import KeyCheck

log = logging.getLogger("docchat.llm")

_TIMEOUT = anthropic.Timeout(10.0, connect=5.0)


class AnthropicKeyValidator:
    async def check(self, key: str) -> KeyCheck:
        client = anthropic.AsyncAnthropic(api_key=key, max_retries=0, timeout=_TIMEOUT)
        try:
            await client.models.list(limit=1)
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            return KeyCheck.INVALID
        except (anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
            # Offline, timeout, rate limit or an outage: the key may be fine.
            log.warning("api_key_check_unreachable", extra={"error": type(exc).__name__})
            return KeyCheck.UNREACHABLE
        finally:
            await client.close()
        return KeyCheck.VALID
