"""The answer run end to end with real SQLite and the fake model."""

import asyncio
from pathlib import Path
from typing import Any

import pytest

from docchat.adapters.fake_llm import FakeLLMClient, FakeScenario
from docchat.domain.enums import (
    ChatScope,
    DocumentStatus,
    ErrorStage,
    Lane,
    LlmStatus,
    MessageRole,
    MessageStatus,
    RunPhase,
    SourcesMode,
)
from docchat.domain.errors import AppError, ErrorCode, NoticeCode
from docchat.domain.llm import LLMError
from docchat.services.answer_run import RunTimings
from docchat.services.run_events import (
    CitationEvent,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    MetaEvent,
    RunEvent,
    SourcesEvent,
    StatusEvent,
)
from tests.services.chat_support import ChatHarness, build_chat_harness

MIRA = (
    "Die Leuchte Mira hat die Schutzart IP66. Sie ist schlagfest nach IK08.",
    "Die Mira leistet 40 W bei 5000 Lumen.",
)


@pytest.fixture
def h(tmp_path: Path) -> ChatHarness:
    return build_chat_harness(tmp_path)


def of(events: list[RunEvent], kind: type[Any]) -> list[Any]:
    return [e for e in events if isinstance(e, kind)]


def terminal(events: list[RunEvent]) -> RunEvent:
    ends = [e for e in events if isinstance(e, DoneEvent | ErrorEvent)]
    assert len(ends) == 1, "exactly one terminal event"
    assert events[-1] is ends[0]
    return ends[0]


def answer_of(h: ChatHarness, events: list[RunEvent]) -> Any:
    meta = of(events, MetaEvent)[0]
    return h.chats_repo.get_message(meta.assistant_message_id)


async def test_normal_answer_streams_cites_and_is_saved(h: ChatHarness) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    events = await h.ask(chat)

    kinds = [type(e).__name__ for e in events]
    assert kinds[:4] == ["MetaEvent", "StatusEvent", "SourcesEvent", "StatusEvent"]
    assert [e.phase for e in of(events, StatusEvent)] == [RunPhase.RETRIEVING, RunPhase.GENERATING]
    sources = of(events, SourcesEvent)[0]
    assert sources.mode is SourcesMode.FULL_CONTEXT
    assert [s.index for s in sources.sources] == [1, 2]

    text = "".join(e.text for e in of(events, DeltaEvent))
    [citation] = [e.citation for e in of(events, CitationEvent)]
    assert citation.source_id == sources.sources[0].id
    assert text[: citation.char_offset].endswith("Die Leuchte Mira hat die Schutzart IP66.")

    done = terminal(events)
    assert isinstance(done, DoneEvent)
    assert done.status is MessageStatus.COMPLETE and done.stop_reason == "end_turn"
    assert done.notices == () and done.cost_usd > 0
    assert done.chat.title == "Welche Schutzart hat die Mira?"

    saved = answer_of(h, events)
    assert saved.status is MessageStatus.COMPLETE
    assert saved.content == text
    assert saved.citations == (citation,)
    assert saved.sources == sources.sources
    assert saved.sources_mode is SourcesMode.FULL_CONTEXT
    assert saved.model == "claude-sonnet-5-5" and saved.ttft_ms is not None
    assert h.ledger.cost_on(h.clock.now().date().isoformat()) == pytest.approx(saved.cost_usd)
    assert h.registry.active == 0


async def test_search_results_carry_chunk_id_title_and_sentences(h: ChatHarness) -> None:
    document = h.add_document(MIRA)
    await h.ask(h.new_chat())
    assert h.llm is not None
    request = h.llm.requests[0]
    first = request.search_results[0]
    assert first.source == h.chunks(document)[0].chunk_id
    assert first.title == "Datenblatt Mira.pdf, S. 1"
    assert first.sentences == (
        "Die Leuchte Mira hat die Schutzart IP66.",
        "Sie ist schlagfest nach IK08.",
    )


async def test_retry_only_before_the_first_delta(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.OVERLOADED, FakeScenario.NORMAL])
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    phases = [(e.phase, e.attempt) for e in of(events, StatusEvent)]
    assert phases == [
        (RunPhase.RETRIEVING, 1),
        (RunPhase.GENERATING, 1),
        (RunPhase.RETRYING, 2),
    ]
    assert h.sleep.waits == [1.0]  # the retry-after of the overloaded error
    assert isinstance(terminal(events), DoneEvent)
    assert len(llm.requests) == 2


async def test_gives_up_after_two_retries(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.OVERLOADED] * 3)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    error = terminal(events)
    assert isinstance(error, ErrorEvent)
    assert (error.code, error.partial, error.stage) == (
        ErrorCode.LLM_OVERLOADED,
        False,
        ErrorStage.LLM,
    )
    assert len(llm.requests) == 3
    assert answer_of(h, events).status is MessageStatus.ERROR


async def test_error_after_the_first_delta_is_never_retried(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.ERROR_MID_STREAM, FakeScenario.NORMAL])
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    error = terminal(events)
    assert isinstance(error, ErrorEvent)
    assert error.code is ErrorCode.LLM_OVERLOADED and error.partial is True
    assert len(llm.requests) == 1
    saved = answer_of(h, events)
    assert saved.status is MessageStatus.ERROR
    assert saved.error_code is ErrorCode.LLM_OVERLOADED
    assert saved.content == "Laut deinen Dokumenten: "  # the partial text stays


async def test_stop_persists_the_partial_answer(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.SLOW], slow_delay_s=0.01)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    chat = h.new_chat()
    run = await h.answers.ask(h.command(chat))
    events: list[RunEvent] = []
    async for event in run.events():
        events.append(event)
        if isinstance(event, DeltaEvent) and len(of(events, DeltaEvent)) == 5:
            assert h.registry.stop(chat.id) == [Lane.A]
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.STOPPED
    saved = answer_of(h, events)
    assert saved.status is MessageStatus.STOPPED
    assert saved.content == "".join(e.text for e in of(events, DeltaEvent))
    assert 0 < len(saved.content) < 200
    assert llm.cancelled == 1
    assert h.registry.active == 0
    assert h.registry.stop(chat.id) == []  # nothing left to stop


async def test_a_listener_that_goes_away_leaves_an_interrupted_answer(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.SLOW], slow_delay_s=0.01)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    run = await h.answers.ask(h.command(h.new_chat()))
    events = run.events()
    async for event in events:
        if isinstance(event, DeltaEvent):
            break
    await events.aclose()  # what a client disconnect does to the SSE generator
    for _ in range(100):
        if h.registry.active == 0:
            break
        await asyncio.sleep(0.01)
    [answer] = [
        m for m in h.chats_repo.list_messages(run.meta.chat_id) if m.role is MessageRole.ASSISTANT
    ]
    assert answer.status is MessageStatus.INTERRUPTED
    assert answer.content
    assert llm.cancelled == 1


async def test_refusal_discards_the_partial_text(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.REFUSAL]))
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    done = terminal(events)
    assert isinstance(done, DoneEvent)
    assert done.status is MessageStatus.REFUSED and done.stop_reason == "refusal"
    assert [n.code for n in done.notices] == [NoticeCode.LLM_REFUSED]
    saved = answer_of(h, events)
    assert saved.content == "" and saved.citations == ()


async def test_max_tokens_keeps_the_text_as_truncated(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.MAX_TOKENS]))
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.TRUNCATED
    assert NoticeCode.ANSWER_TRUNCATED in [n.code for n in done.notices]
    assert answer_of(h, events).content


async def test_empty_answer_is_an_error(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.EMPTY]))
    h.add_document(MIRA)
    error = terminal(await h.ask(h.new_chat()))
    assert isinstance(error, ErrorEvent)
    assert (error.code, error.partial) == (ErrorCode.LLM_EMPTY_ANSWER, False)


async def test_answer_without_citations_gets_a_notice(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.NO_CITATIONS]))
    h.add_document(MIRA)
    done = terminal(await h.ask(h.new_chat()))
    assert isinstance(done, DoneEvent)
    assert [n.code for n in done.notices] == [NoticeCode.NO_CITATIONS]


async def test_model_switch_is_a_notice_and_priced_per_model(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.FALLBACK]))
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    done = terminal(events)
    assert isinstance(done, DoneEvent)
    [switch] = [n for n in done.notices if n.code is NoticeCode.MODEL_SWITCHED]
    assert dict(switch.params) == {"old": "claude-sonnet-5-5", "new": "claude-sonnet-5"}
    saved = answer_of(h, events)
    assert saved.model == "claude-sonnet-5"
    assert saved.usage is not None and saved.usage.output_tokens > 3  # both attempts counted


async def test_scope_selection_and_ready_filter(h: ChatHarness) -> None:
    chosen = h.add_document(MIRA)
    h.add_document(("Die Luna hat IP65.",), filename="Luna.pdf")  # ready, not selected
    busy = h.add_document(("Noch in Arbeit.",), status=DocumentStatus.EMBEDDING)
    chat = h.new_chat(ChatScope.SELECTED, [chosen.id, busy.id])
    events = await h.ask(chat)
    sources = of(events, SourcesEvent)[0]
    assert {s.document_id for s in sources.sources} == {chosen.id}
    assert [(n.code, dict(n.params)) for n in sources.notices] == [
        (NoticeCode.SOURCES_PARTIAL, {"count": 1})
    ]


async def test_only_processing_documents_mean_not_ready(h: ChatHarness) -> None:
    h.add_document(MIRA, status=DocumentStatus.PARSING)
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(h.new_chat()))
    assert caught.value.code is ErrorCode.DOCUMENTS_NOT_READY
    assert caught.value.retry_after == 3


async def test_no_documents(h: ChatHarness) -> None:
    h.add_document(MIRA, status=DocumentStatus.FAILED)
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(h.new_chat()))
    assert caught.value.code is ErrorCode.NO_DOCUMENTS
    assert h.chats_repo.list_messages(h.chats.list_chats()[0].chat.id) == []


async def test_large_scopes_use_hybrid_search_with_top_k(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, full_context_max_tokens=10)
    texts = [f"Abschnitt {i} über Leuchten." for i in range(12)]
    h.add_document(texts, char_count=10_000)
    events = await h.ask(h.new_chat(), "Fasse den Katalog zusammen")
    sources = of(events, SourcesEvent)[0]
    assert sources.mode is SourcesMode.RETRIEVAL
    assert len(sources.sources) == 8
    assert [n.code for n in sources.notices] == [NoticeCode.SUMMARY_PARTIAL]
    assert h.vectors.searches[0][2] == 20  # candidates


async def test_small_scopes_send_every_chunk_in_order(h: ChatHarness) -> None:
    first = h.add_document(MIRA)
    second = h.add_document(("Luna A.", "Luna B."), filename="Luna.pdf")
    await h.ask(h.new_chat())
    assert h.llm is not None
    sent = [r.source for r in h.llm.requests[0].search_results]
    expected = [c.chunk_id for d in (first, second) for c in h.chunks(d)]
    assert sorted(sent) == sorted(expected)
    assert h.vectors.searches == []


async def test_follow_up_searches_with_the_previous_question(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, full_context_max_tokens=0)
    h.add_document(MIRA)
    chat = h.new_chat()
    await h.ask(chat, "Welche Schutzart hat die Mira?")
    await h.ask(chat, "Und die Leistung?")
    assert h.vectors.searches[1][0] == "Welche Schutzart hat die Mira?\nUnd die Leistung?"
    assert h.llm is not None
    second = h.llm.requests[1]
    assert [t.question for t in second.history] == ["Welche Schutzart hat die Mira?"]
    assert second.history[0].answer.startswith("Laut deinen Dokumenten")


async def test_without_a_model_the_run_returns_sources_only(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, without_llm=True)
    h.add_document(MIRA)
    events = await h.ask(h.new_chat())
    assert [type(e).__name__ for e in events] == [
        "MetaEvent",
        "StatusEvent",
        "SourcesEvent",
        "DoneEvent",
    ]
    sources = of(events, SourcesEvent)[0]
    assert sources.mode is SourcesMode.RETRIEVAL_ONLY and sources.sources
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.SOURCES_ONLY
    assert [n.code for n in done.notices] == [NoticeCode.LLM_NOT_CONFIGURED]
    assert answer_of(h, events).status is MessageStatus.SOURCES_ONLY


async def test_rejected_key_switches_to_sources_only(tmp_path: Path) -> None:
    class RejectingLLM(FakeLLMClient):
        async def stream(self, request: Any) -> Any:  # type: ignore[override]
            raise LLMError(ErrorCode.LLM_AUTH)
            yield  # pragma: no cover

    h = build_chat_harness(tmp_path, llm=RejectingLLM())
    h.add_document(MIRA)
    chat = h.new_chat()
    error = terminal(await h.ask(chat))
    assert isinstance(error, ErrorEvent) and error.code is ErrorCode.LLM_AUTH
    assert h.health.status is LlmStatus.INVALID_KEY
    done = terminal(await h.ask(chat, "Noch einmal?"))
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.SOURCES_ONLY


async def test_first_token_timeout(tmp_path: Path) -> None:
    llm = FakeLLMClient(delay_s=1.0)
    h = build_chat_harness(tmp_path, llm=llm, timings=RunTimings(ttft_timeout_s=0.05))
    h.add_document(MIRA)
    error = terminal(await h.ask(h.new_chat()))
    assert isinstance(error, ErrorEvent) and error.code is ErrorCode.LLM_TIMEOUT


async def test_duplicate_client_message_id(h: ChatHarness) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    command = h.command(chat)
    run = await h.answers.ask(command)
    [_ async for _ in run.events()]
    with pytest.raises(AppError) as caught:
        await h.answers.ask(command)
    assert caught.value.code is ErrorCode.DUPLICATE_REQUEST


async def test_one_answer_per_lane_and_a_global_limit(tmp_path: Path) -> None:
    llm = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.01)
    h = build_chat_harness(tmp_path, llm=llm, max_concurrent=2)
    h.add_document(MIRA)
    first, second, third = h.new_chat(), h.new_chat(), h.new_chat()
    runs = [await h.answers.ask(h.command(first))]
    with pytest.raises(AppError) as busy:
        await h.answers.ask(h.command(first))
    assert busy.value.code is ErrorCode.CHAT_BUSY
    runs.append(await h.answers.ask(h.command(second)))
    with pytest.raises(AppError) as limit:
        await h.answers.ask(h.command(third))
    assert limit.value.code is ErrorCode.CONCURRENCY_LIMIT
    assert limit.value.params == {"max": 2} and limit.value.retry_after == 5
    for chat in (first, second):
        h.registry.stop(chat.id)
    for run in runs:
        [_ async for _ in run.events()]
    assert h.registry.active == 0


async def test_budget_blocks_until_midnight(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, daily_budget_usd=0.01)
    h.add_document(MIRA)
    h.ledger.record(h.clock.now().date().isoformat(), 0.02, 1, 1)
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(h.new_chat()))
    assert caught.value.code is ErrorCode.TOKEN_BUDGET_EXCEEDED
    assert caught.value.params == {"reset_time": "2026-10-01T00:00:00Z"}
    assert caught.value.retry_after == 12 * 3600


async def test_question_checks(h: ChatHarness) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    cases = [("   ", ErrorCode.QUESTION_EMPTY), ("x" * 4001, ErrorCode.QUESTION_TOO_LONG)]
    for content, code in cases:
        with pytest.raises(AppError) as caught:
            await h.answers.ask(h.command(chat, content))
        assert caught.value.code is code
    with pytest.raises(AppError) as model:
        await h.answers.ask(
            h.command(chat, options=h.options.__class__(model="gpt-4", locale=h.options.locale))
        )
    assert model.value.code is ErrorCode.MODEL_NOT_ALLOWED


async def test_message_limit(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, max_messages=2)
    h.add_document(MIRA)
    chat = h.new_chat()
    await h.ask(chat)
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(chat))
    assert caught.value.code is ErrorCode.MESSAGE_LIMIT


async def test_regenerate_replaces_the_answer_in_place(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.ERROR_MID_STREAM, FakeScenario.NORMAL])
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    chat = h.new_chat()
    first = await h.ask(chat)
    failed = answer_of(h, first)
    run = await h.answers.regenerate(chat.id, failed.id, h.options)
    events = [e async for e in run.events()]
    assert of(events, MetaEvent)[0].assistant_message_id == failed.id
    assert isinstance(terminal(events), DoneEvent)
    messages = h.chats_repo.list_messages(chat.id)
    assert [m.role for m in messages] == [MessageRole.USER, MessageRole.ASSISTANT]
    assert messages[1].status is MessageStatus.COMPLETE
    assert llm.requests[1].question == llm.requests[0].question


async def test_regenerate_only_for_the_latest_question(h: ChatHarness) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    older = answer_of(h, await h.ask(chat))
    await h.ask(chat, "Und die Leistung?")
    with pytest.raises(AppError) as caught:
        await h.answers.regenerate(chat.id, older.id, h.options)
    assert caught.value.code is ErrorCode.MESSAGE_NOT_LATEST
    with pytest.raises(AppError) as missing:
        await h.answers.regenerate(chat.id, "nope", h.options)
    assert missing.value.code is ErrorCode.NOT_FOUND


async def test_the_user_name_never_reaches_the_model(h: ChatHarness) -> None:
    h.add_document(MIRA)
    await h.ask(h.new_chat())
    assert h.llm is not None
    request = h.llm.requests[0]
    assert "name" not in {f for f in request.__dataclass_fields__}


async def test_a_request_cancelled_during_preparation_leaves_nothing_taken(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    import time

    h.add_document(MIRA)
    chat = h.new_chat()
    prepare = h.answers._prepare_ask

    def slow_prepare(command: Any) -> Any:
        result = prepare(command)
        time.sleep(0.1)  # the request is cancelled while the thread still works
        return result

    monkeypatch.setattr(h.answers, "_prepare_ask", slow_prepare)
    request = asyncio.create_task(h.answers.ask(h.command(chat)))
    await asyncio.sleep(0.02)
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    for _ in range(100):
        answers = [
            m for m in h.chats_repo.list_messages(chat.id) if m.role is MessageRole.ASSISTANT
        ]
        if h.registry.active == 0 and answers and answers[0].status is not MessageStatus.STREAMING:
            break
        await asyncio.sleep(0.01)
    assert h.registry.active == 0
    assert answers[0].status is MessageStatus.INTERRUPTED
