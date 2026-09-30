"""Claude over the official SDK. Retries are the service's job (visible, only before the first
delta), so the SDK never retries on its own, and every timeout is explicit."""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

import anthropic
import httpx2

from docchat.adapters.anthropic.error_mapper import map_error
from docchat.adapters.anthropic.request_builder import SonnetThinking, build_request
from docchat.adapters.anthropic.stream_mapper import StreamMapper
from docchat.domain.errors import ErrorCode
from docchat.domain.llm import LLMError, LLMEvent, LLMRequest, RequestStarted
from docchat.domain.model_profiles import MODEL_PROFILES

log = logging.getLogger("docchat.llm")

# The SDK default is 10 minutes per attempt; the service adds 60 s to the first delta and
# 180 s in total on top.
TIMEOUT = anthropic.Timeout(60.0, connect=5.0, read=60.0, write=10.0, pool=5.0)


def _sdk_client(api_key: str) -> Any:
    return anthropic.AsyncAnthropic(api_key=api_key, max_retries=0, timeout=TIMEOUT)


class AnthropicLLMClient:
    def __init__(
        self,
        api_key: str,
        *,
        sonnet_thinking: SonnetThinking = "adaptive",
        concurrency: int = 4,
        sdk: Any = None,  # tests pass a stand-in with the same `beta.messages.create`
    ) -> None:
        self._sdk = sdk or _sdk_client(api_key)
        self._sonnet_thinking = sonnet_thinking
        self._semaphore = asyncio.Semaphore(concurrency)

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMEvent]:
        profile = MODEL_PROFILES.get(request.model)
        if profile is None:
            raise LLMError(ErrorCode.MODEL_UNAVAILABLE)
        body = build_request(request, profile, sonnet_thinking=self._sonnet_thinking)
        mapper = StreamMapper(request.model)
        async with self._semaphore:
            yield RequestStarted()
            try:
                stream = await self._sdk.beta.messages.create(stream=True, **body)
                # Leaving this block (end, error or cancellation) closes the HTTP connection,
                # which stops the generation at Anthropic.
                async with stream:
                    async for event in stream:
                        for mapped in mapper.feed(event):
                            yield mapped
            except (anthropic.APIError, httpx2.TransportError) as exc:
                error = map_error(exc)
                log.warning(
                    "llm_error",
                    extra={
                        "code": error.code.value,
                        "model": request.model,
                        "anthropic_request_id": error.upstream_request_id,
                    },
                )
                raise error from exc
