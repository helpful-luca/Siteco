"""The answer run end to end with real SQLite and the fake model."""

import asyncio
import threading
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
from tests.waiting import PATIENCE_S, eventually

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
    assert sources.sources == ()  # nothing shown up front: only what is cited
    [added] = of(events, SourcesEvent)[1].sources
    assert added.index == 1

    text = "".join(e.text for e in of(events, DeltaEvent))
    [citation] = [e.citation for e in of(events, CitationEvent)]
    assert citation.source_id == added.id
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
    assert saved.sources == (added,)
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
    llm = FakeLLMClient([FakeScenario.SLOW], slow_delay_s=0.05)
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
    llm = FakeLLMClient([FakeScenario.SLOW], slow_delay_s=0.05)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    run = await h.answers.ask(h.command(h.new_chat()))
    events = run.events()
    async for event in events:
        if isinstance(event, DeltaEvent):
            break
    await events.aclose()  # what a client disconnect does to the SSE generator
    await eventually(lambda: h.registry.active == 0)
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
    assert h.llm is not None
    sent = {r.title.split(",")[0] for r in h.llm.requests[0].search_results}
    assert sent == {"Datenblatt Mira.pdf"}  # the chosen document, not Luna
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


async def test_a_key_without_workspace_switches_to_sources_only(tmp_path: Path) -> None:
    class NoWorkspaceLLM(FakeLLMClient):
        async def stream(self, request: Any) -> Any:  # type: ignore[override]
            raise LLMError(ErrorCode.LLM_KEY_NEEDS_WORKSPACE)
            yield  # pragma: no cover

    h = build_chat_harness(tmp_path, llm=NoWorkspaceLLM())
    h.add_document(MIRA)
    chat = h.new_chat()
    error = terminal(await h.ask(chat))
    assert isinstance(error, ErrorEvent) and error.code is ErrorCode.LLM_KEY_NEEDS_WORKSPACE
    assert h.health.status is LlmStatus.NEEDS_WORKSPACE
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
    llm = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.05)
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


def _held_preparation(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> tuple[threading.Event, threading.Event]:
    """Preparation that stops after the lane is reserved and the rows are saved, until the test
    releases it. Events instead of sleeps: the test must not bet on thread timing."""
    prepared, release = threading.Event(), threading.Event()
    prepare = h.answers._prepare_ask

    def held(command: Any) -> Any:
        result = prepare(command)
        prepared.set()
        release.wait(PATIENCE_S)
        return result

    monkeypatch.setattr(h.answers, "_prepare_ask", held)
    return prepared, release


def _answers(h: ChatHarness, chat_id: str) -> list[Any]:
    return [m for m in h.chats_repo.list_messages(chat_id) if m.role is MessageRole.ASSISTANT]


async def test_a_request_cancelled_during_preparation_leaves_nothing_taken(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    prepared, release = _held_preparation(h, monkeypatch)
    request = asyncio.create_task(h.answers.ask(h.command(chat)))
    await asyncio.to_thread(prepared.wait, PATIENCE_S)
    request.cancel()  # the request goes away while the thread still works
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await request
    await eventually(
        lambda: (
            h.registry.active == 0
            and any(a.status is not MessageStatus.STREAMING for a in _answers(h, chat.id))
        )
    )
    assert _answers(h, chat.id)[0].status is MessageStatus.INTERRUPTED


# Review fixes: saving, deletion during preparation, stale plans, queue time, atomic inserts


async def test_a_failing_usage_ledger_keeps_the_completed_answer(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    h.add_document(MIRA)

    def broken(*_: Any) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr(h.ledger, "record", broken)
    events = await h.ask(h.new_chat())
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.COMPLETE
    assert answer_of(h, events).status is MessageStatus.COMPLETE


async def test_a_failing_chat_reload_keeps_the_done_event(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    run = await h.answers.ask(h.command(chat))

    def broken(*_: Any) -> None:
        raise RuntimeError("locked")

    monkeypatch.setattr(h.chats_repo, "get_chat", broken)
    events = [e async for e in run.events()]
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.COMPLETE
    assert done.chat.id == chat.id
    monkeypatch.undo()
    assert answer_of(h, events).status is MessageStatus.COMPLETE


async def test_a_failed_save_still_marks_the_answer_as_error(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    h.add_document(MIRA)
    save = h.chats_repo.save_message
    calls: list[Any] = []

    def flaky(message: Any) -> bool:
        calls.append(message)
        if len(calls) == 1:
            raise RuntimeError("database is locked")
        return save(message)

    monkeypatch.setattr(h.chats_repo, "save_message", flaky)
    events = await h.ask(h.new_chat())
    error = terminal(events)
    assert isinstance(error, ErrorEvent)
    assert (error.code, error.stage) == (ErrorCode.INTERNAL_ERROR, ErrorStage.PERSIST)
    saved = answer_of(h, events)
    assert saved.status is MessageStatus.ERROR
    assert saved.error_code is ErrorCode.INTERNAL_ERROR


async def test_deleting_a_chat_during_preparation_waits_for_it(
    h: ChatHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    h.add_document(MIRA)
    chat = h.new_chat()
    prepared, release = _held_preparation(h, monkeypatch)
    request = asyncio.create_task(h.answers.ask(h.command(chat)))
    await asyncio.to_thread(prepared.wait, PATIENCE_S)
    assert h.registry.active == 1  # reserved and saved, but the run task does not exist yet
    deletion = asyncio.create_task(h.chats.delete(chat.id))
    await eventually(lambda: all(c.stop_reason for c in h.registry._controls(chat.id, None)))
    assert not deletion.done()  # it waits for the answer being prepared
    release.set()
    await deletion
    run = await request
    events = [e async for e in run.events()]
    assert isinstance(terminal(events), DoneEvent)
    assert h.registry.active == 0
    assert h.chats_repo.get_chat(chat.id) is None
    assert h.chats_repo.list_messages(chat.id) == []
    assert h.llm is not None and h.llm.requests == []


async def test_a_document_deleted_after_planning_is_not_used(h: ChatHarness) -> None:
    kept = h.add_document(MIRA)
    gone = h.add_document(("Die Luna hat IP65.",), filename="Luna.pdf")
    chat = h.new_chat()
    plan = h.answers._deps.retrieval.plan(chat)
    h.documents.mark_deleting(gone.id, h.clock.now())
    retrieved = await h.answers._deps.retrieval.retrieve(plan, "Schutzart", "Schutzart")
    assert {c.document_id for c in retrieved.chunks} == {kept.id}
    assert set(retrieved.documents) == {kept.id}


async def test_waiting_for_a_model_slot_does_not_count_as_first_token_time(
    tmp_path: Path,
) -> None:
    class QueuedLLM(FakeLLMClient):
        async def stream(self, request: Any) -> Any:  # type: ignore[override]
            await asyncio.sleep(1.0)  # waiting for a free slot, twice the TTFT limit
            async for event in super().stream(request):
                yield event

    # The limit is generous for the few steps after the slot: only the wait may not count.
    h = build_chat_harness(tmp_path, llm=QueuedLLM(), timings=RunTimings(ttft_timeout_s=0.5))
    h.add_document(MIRA)
    done = terminal(await h.ask(h.new_chat()))
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.COMPLETE


async def test_the_first_token_timeout_is_not_retried(tmp_path: Path) -> None:
    llm = FakeLLMClient(delay_s=1.0)
    h = build_chat_harness(tmp_path, llm=llm, timings=RunTimings(ttft_timeout_s=0.05))
    h.add_document(MIRA)
    error = terminal(await h.ask(h.new_chat()))
    assert isinstance(error, ErrorEvent) and error.code is ErrorCode.LLM_TIMEOUT
    assert len(llm.requests) == 1


# Own rate limit and model availability (WP-F)


async def test_chat_rate_limit_refuses_before_anything_is_saved(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, chat_per_minute=1)
    h.add_document(MIRA)
    chat = h.new_chat()
    events = await h.ask(chat)
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(chat, "Und die Leistung?"))
    assert caught.value.code is ErrorCode.RATE_LIMITED
    assert caught.value.params == {"seconds": 60, "scope": "chat"}
    assert caught.value.retry_after == 60
    assert len(h.chats_repo.list_messages(chat.id)) == 2  # the refused question left no trace
    assert h.registry.active == 0  # the lane reserved for the check was given back
    # Regenerating asks the model again, so it counts too; after the window it passes.
    answer = answer_of(h, events)
    with pytest.raises(AppError) as again:
        await h.answers.regenerate(chat.id, answer.id, h.options)
    assert again.value.code is ErrorCode.RATE_LIMITED
    h.ticker.advance(60)
    run = await h.answers.regenerate(chat.id, answer.id, h.options)
    assert isinstance(terminal([e async for e in run.events()]), DoneEvent)


async def test_other_refusals_do_not_use_up_the_rate_limit(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, chat_per_minute=1)
    chat = h.new_chat()
    with pytest.raises(AppError) as caught:
        await h.answers.ask(h.command(chat))
    assert caught.value.code is ErrorCode.NO_DOCUMENTS
    h.add_document(MIRA)
    assert isinstance(terminal(await h.ask(chat)), DoneEvent)


async def test_a_model_claude_does_not_know_is_unavailable_for_a_while(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, llm=FakeLLMClient([FakeScenario.MODEL_NOT_FOUND]))
    h.add_document(MIRA)
    chat = h.new_chat()
    end = terminal(await h.ask(chat))
    assert isinstance(end, ErrorEvent) and end.code is ErrorCode.MODEL_UNAVAILABLE
    assert end.params == {"model": "claude-sonnet-5-5", "fallback": "claude-haiku-4-5"}
    assert h.models.is_available("claude-sonnet-5-5") is False
    with pytest.raises(AppError) as refused:
        await h.answers.ask(h.command(chat, "Und die Leistung?"))
    assert refused.value.code is ErrorCode.MODEL_UNAVAILABLE
    assert refused.value.params == {"model": "claude-sonnet-5-5", "fallback": "claude-haiku-4-5"}
    haiku = h.options.__class__(model="claude-haiku-4-5", locale=h.options.locale)
    assert isinstance(terminal(await h.ask(chat, "Und die Leistung?", options=haiku)), DoneEvent)


async def test_a_404_without_not_found_error_does_not_mark_the_model(tmp_path: Path) -> None:
    class BareNotFound(FakeLLMClient):
        async def stream(self, request: Any) -> Any:  # type: ignore[override]
            raise LLMError(ErrorCode.MODEL_UNAVAILABLE)  # model_gone stays False
            yield  # pragma: no cover

    h = build_chat_harness(tmp_path, llm=BareNotFound())
    h.add_document(MIRA)
    end = terminal(await h.ask(h.new_chat()))
    assert isinstance(end, ErrorEvent) and end.code is ErrorCode.MODEL_UNAVAILABLE
    assert h.models.is_available("claude-sonnet-5-5") is True


async def test_the_title_names_the_product_of_the_page(h: ChatHarness) -> None:
    # A chunk with only table rows still says whose rows they are; the page stays last.
    h.add_document(
        ("Lichtstrom 34.500 lm.", "Zubehör: Deckenbügel."),
        filename="Katalog.pdf",
        headings=("Highbay 11 midi", ""),
    )
    await h.ask(h.new_chat(), "Was steht auf Seite 1 und 2?")
    assert h.llm is not None
    assert [r.title for r in h.llm.requests[0].search_results] == [
        "Katalog.pdf, Highbay 11 midi, S. 1",
        "Katalog.pdf, S. 2",
    ]


async def test_full_context_request_sends_the_documents_first(h: ChatHarness) -> None:
    h.add_document(MIRA)
    await h.ask(h.new_chat(), "Was steht auf Seite 2?")
    assert h.llm is not None
    request = h.llm.requests[0]
    assert request.documents_first is True
    assert request.requested_pages == (2,)
    assert [r.title for r in request.search_results] == [
        "Datenblatt Mira.pdf, S. 1",
        "Datenblatt Mira.pdf, S. 2",
    ]


MANY_PAGES = tuple(
    f"Seite {n}: Die Leuchte Modell{n} hat die Schutzart IP{n}." for n in range(1, 61)
)


async def test_full_context_shows_and_saves_only_the_cited_chunks(h: ChatHarness) -> None:
    h.add_document(MANY_PAGES)
    events = await h.ask(h.new_chat(), "Welche Schutzart hat Modell7?")
    shown = [s for e in of(events, SourcesEvent) for s in e.sources]
    assert h.llm is not None
    assert len(h.llm.requests[0].search_results) == 60  # the model got everything
    assert len(shown) == 1 and shown[0].page == 7  # the user sees what was cited
    assert answer_of(h, events).sources == tuple(shown)


async def test_a_page_question_shows_that_page_up_front_capped(h: ChatHarness) -> None:
    h.add_document(MANY_PAGES)
    events = await h.ask(h.new_chat(), "Was steht auf Seiten 1 bis 20?")
    first = of(events, SourcesEvent)[0]
    assert 0 < len(first.sources) <= 12
    assert [s.index for s in first.sources] == list(range(1, len(first.sources) + 1))
    assert len(answer_of(h, events).sources) <= 13  # the page chunks plus a cited one


async def test_a_scope_too_large_for_the_model_is_searched_and_says_so(h: ChatHarness) -> None:
    h.add_document(MANY_PAGES)
    assert h.llm is not None
    h.llm.token_count = 9_999_999  # what the counting API reports
    events = await h.ask(h.new_chat(), "Welche Schutzart hat Modell7?")
    first = of(events, SourcesEvent)[0]
    assert first.mode is SourcesMode.RETRIEVAL
    assert [n.code for n in first.notices] == [NoticeCode.CONTEXT_REDUCED]
    assert h.llm.requests[0].documents_first is False
    assert len(h.llm.requests[0].search_results) <= 8
    assert answer_of(h, events).sources_mode is SourcesMode.RETRIEVAL


async def test_counted_tokens_are_cached_per_scope_and_model(h: ChatHarness) -> None:
    h.add_document(MANY_PAGES)
    assert h.llm is not None
    h.llm.token_count = 1_000
    chat = h.new_chat()
    await h.ask(chat)
    await h.ask(chat, "Und Modell9?")
    assert len(h.llm.counted) == 1
    assert h.llm.requests[1].documents_first is True


async def test_without_a_count_the_estimate_is_conservative(tmp_path: Path) -> None:
    small = build_chat_harness(tmp_path, full_context_max_tokens=100)
    # 380 characters: 95 tokens at four per token, 152 at two and a half.
    small.add_document(("x" * 190, "y" * 190))
    events = await small.ask(small.new_chat())
    assert of(events, SourcesEvent)[0].mode is SourcesMode.RETRIEVAL


async def test_context_too_large_before_the_first_delta_retries_with_search(
    tmp_path: Path,
) -> None:
    llm = FakeLLMClient([FakeScenario.CONTEXT_TOO_LARGE])
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MANY_PAGES)
    events = await h.ask(h.new_chat(), "Welche Schutzart hat Modell7?")
    assert [e.phase for e in of(events, StatusEvent)] == [
        RunPhase.RETRIEVING,
        RunPhase.GENERATING,
        RunPhase.RETRYING,
    ]
    modes = [e.mode for e in of(events, SourcesEvent)]
    assert modes[0] is SourcesMode.FULL_CONTEXT and SourcesMode.RETRIEVAL in modes
    assert [r.documents_first for r in llm.requests] == [True, False]
    done = terminal(events)
    assert isinstance(done, DoneEvent) and done.status is MessageStatus.COMPLETE
    saved = answer_of(h, events)
    assert NoticeCode.CONTEXT_REDUCED in [n.code for n in saved.notices]
    assert saved.sources_mode is SourcesMode.RETRIEVAL
