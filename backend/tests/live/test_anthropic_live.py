"""One real call to Claude. Never runs in CI or the gates: needs RUN_LIVE=1 and a key."""

import os

import pytest

from docchat.adapters.anthropic.client import AnthropicLLMClient
from docchat.domain.enums import AnswerStyle, Locale
from docchat.domain.llm import (
    CitationDelta,
    Completed,
    LLMEvent,
    LLMRequest,
    SearchResult,
    TextDelta,
    UsageReported,
)

# Read at import: the autouse fixture in conftest removes the key from the environment.
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not API_KEY, reason="live test: set ANTHROPIC_API_KEY"),
]

REQUEST = LLMRequest(
    model="claude-sonnet-5-5",
    effort=None,
    history=(),
    search_results=(
        SearchResult(
            "0b6f3c1e-8f5a-4d7e-9a51-2b1c0d9e8f70",
            "Datenblatt Mira.pdf, S. 2",
            ("Die Leuchte Mira hat die Schutzart IP66.", "Sie ist schlagfest nach IK08."),
        ),
    ),
    question="Welche Schutzart hat die Mira?",
    ui_language=Locale.DE,
    answer_style=AnswerStyle.CONCISE,
    max_tokens=1024,
)


async def _call(client: AnthropicLLMClient) -> list[LLMEvent]:
    return [event async for event in client.stream(REQUEST)]


async def test_real_answer_cites_the_search_result_and_reads_the_cache() -> None:
    client = AnthropicLLMClient(API_KEY)
    first = await _call(client)
    text = "".join(e.text for e in first if isinstance(e, TextDelta))
    assert "IP66" in text
    assert any(
        isinstance(e, CitationDelta) and e.source == REQUEST.search_results[0].source for e in first
    )
    assert isinstance(first[-1], Completed) and first[-1].stop_reason == "end_turn"

    second = await _call(client)  # the static system prompt is cached by now
    usage = [e for e in second if isinstance(e, UsageReported)][-1].parts[0].usage
    assert usage.cache_read_input_tokens > 0
