"""The Claude client behind a handle that can change while the app runs.

Answers hold this handle, not a client, so a key saved in Settings applies to the next
question without a restart. A running answer keeps the client it started with."""

from collections.abc import AsyncIterator

from docchat.domain.errors import ErrorCode
from docchat.domain.llm import LLMError, LLMEvent, LLMRequest
from docchat.domain.ports import LLMClient


class SwappableLLM:
    def __init__(self, client: LLMClient | None = None) -> None:
        self.current = client

    async def swap(self, client: LLMClient | None) -> None:
        """Uses `client` from now on and closes the previous one (if it can be closed; it
        finishes the answers it is still streaming first)."""
        old, self.current = self.current, client
        close = getattr(old, "aclose", None)
        if old is not None and old is not client and close is not None:
            await close()

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMEvent]:
        client = self.current
        if client is None:  # the health check keeps answers from getting here without a key
            raise LLMError(ErrorCode.LLM_AUTH)
        return client.stream(request)
