"""Decides whether a scope's documents go to the model complete (full-context mode).

The size is counted by Claude's free token counting API when a client is available (cached per
scope and model, so follow-up questions cost nothing), otherwise estimated conservatively.
"""

import hashlib
from collections.abc import Sequence

from docchat.domain.context_budget import conservative_tokens, full_context_limit
from docchat.domain.enums import AnswerStyle, Locale
from docchat.domain.llm import LLMRequest, SearchResult
from docchat.domain.ports import LLMClient

_CACHE_LIMIT = 64


class ContextBudget:
    def __init__(self, max_tokens: int = 50_000, history_margin: int = 8_000) -> None:
        self._max_tokens = max_tokens
        self._history_margin = history_margin
        self._counted: dict[tuple[str, str], int] = {}

    async def fits(
        self,
        llm: LLMClient,
        model: str,
        results: Sequence[SearchResult],
        max_output_tokens: int,
    ) -> bool:
        limit = full_context_limit(
            configured=self._max_tokens,
            model=model,
            max_output_tokens=max_output_tokens,
            history_margin=self._history_margin,
        )
        if limit <= 0:
            return False
        return await self._size(llm, model, results) <= limit

    async def _size(self, llm: LLMClient, model: str, results: Sequence[SearchResult]) -> int:
        key = (model, _scope_key(results))
        if key in self._counted:
            return self._counted[key]
        request = LLMRequest(
            model=model,
            effort=None,
            history=(),
            search_results=tuple(results),
            question=".",
            ui_language=Locale.DE,
            answer_style=AnswerStyle.CONCISE,
            max_tokens=1,
            allow_fallbacks=False,
            documents_first=True,
        )
        counted = await llm.count_tokens(request)
        if counted is None:
            chars = sum(len(r.title) + sum(len(s) for s in r.sentences) for r in results)
            return conservative_tokens(chars)  # not cached: the key may be saved later
        if len(self._counted) >= _CACHE_LIMIT:
            self._counted.clear()
        self._counted[key] = counted
        return counted


def _scope_key(results: Sequence[SearchResult]) -> str:
    digest = hashlib.sha1(usedforsecurity=False)
    for result in results:
        digest.update(result.source.encode())
    return digest.hexdigest()
