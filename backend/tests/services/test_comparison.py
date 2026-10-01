"""Comparison mode: two lanes answer one question (annex 11, 1.3 and 3.3; annex 10, F4 to F9)."""

from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest

from docchat.adapters.fake_llm import FakeLLMClient, FakeScenario
from docchat.domain.chat_models import Chat
from docchat.domain.enums import Lane, MessageRole, MessageStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.answer_service import AskCommand
from docchat.services.run_events import DoneEvent, ErrorEvent, MetaEvent, RunEvent
from tests.services.chat_support import ChatHarness, build_chat_harness

MIRA = ("Die Leuchte Mira hat die Schutzart IP66. Sie ist schlagfest nach IK08.",)


def lane_command(
    h: ChatHarness, chat: Chat, lane: Lane, model: str, *, client_id: str, comparison: str
) -> AskCommand:
    return h.command(
        chat,
        client_message_id=client_id,
        options=replace(h.options, model=model),
        lane=lane,
        comparison_id=comparison,
    )


async def compare(
    h: ChatHarness, chat: Chat, models: tuple[str, str] = ("claude-sonnet-5-5", "claude-haiku-4-5")
) -> tuple[list[RunEvent], list[RunEvent]]:
    client_id, comparison = str(uuid4()), str(uuid4())
    run_a = await h.answers.ask(
        lane_command(h, chat, Lane.A, models[0], client_id=client_id, comparison=comparison)
    )
    run_b = await h.answers.ask(
        lane_command(h, chat, Lane.B, models[1], client_id=client_id, comparison=comparison)
    )
    events_a = [e async for e in run_a.events()]
    events_b = [e async for e in run_b.events()]
    return events_a, events_b


def meta(events: list[RunEvent]) -> MetaEvent:
    return next(e for e in events if isinstance(e, MetaEvent))


async def test_two_lanes_answer_the_same_question_without_fallbacks(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    h.add_document(MIRA)
    chat = h.new_chat()
    events_a, events_b = await compare(h, chat)

    meta_a, meta_b = meta(events_a), meta(events_b)
    assert meta_a.user_message_id == meta_b.user_message_id
    assert (meta_a.lane, meta_b.lane) == (Lane.A, Lane.B)
    assert meta_a.comparison_id == meta_b.comparison_id is not None
    messages = h.chats_repo.list_messages(chat.id)
    assert [m.role for m in messages].count(MessageRole.USER) == 1
    answers = {m.lane: m for m in messages if m.role is MessageRole.ASSISTANT}
    assert answers[Lane.A].model == "claude-sonnet-5-5"
    assert answers[Lane.B].model == "claude-haiku-4-5"
    assert answers[Lane.A].is_preferred and not answers[Lane.B].is_preferred
    assert all(a.status is MessageStatus.COMPLETE for a in answers.values())
    assert h.llm is not None
    assert [r.allow_fallbacks for r in h.llm.requests] == [False, False]


async def test_the_second_lane_must_use_another_model(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    h.add_document(MIRA)
    chat = h.new_chat()
    client_id, comparison = str(uuid4()), str(uuid4())
    sonnet = "claude-sonnet-5-5"
    run = await h.answers.ask(
        lane_command(h, chat, Lane.A, sonnet, client_id=client_id, comparison=comparison)
    )
    with pytest.raises(AppError) as caught:
        await h.answers.ask(
            lane_command(h, chat, Lane.B, sonnet, client_id=client_id, comparison=comparison)
        )
    assert caught.value.code is ErrorCode.COMPARE_SAME_MODEL
    assert caught.value.status == 422
    [_ async for _ in run.events()]
    assert h.registry.active == 0


async def test_a_comparison_counts_twice_and_is_refused_as_a_whole(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path, chat_per_minute=3)
    h.add_document(MIRA)
    chat = h.new_chat()
    await compare(h, chat)  # counts 2 of 3
    with pytest.raises(AppError) as caught:  # lane a needs 2, only 1 is left
        await h.answers.ask(
            lane_command(
                h,
                chat,
                Lane.A,
                "claude-sonnet-5-5",
                client_id=str(uuid4()),
                comparison=str(uuid4()),
            )
        )
    assert caught.value.code is ErrorCode.RATE_LIMITED
    await h.ask(chat)  # a single question still fits
    assert h.registry.active == 0


async def test_a_comparison_needs_two_free_answer_slots(tmp_path: Path) -> None:
    llm = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.05)
    h = build_chat_harness(tmp_path, llm=llm, max_concurrent=2)
    h.add_document(MIRA)
    busy, chat = h.new_chat(), h.new_chat()
    running = await h.answers.ask(h.command(busy))
    with pytest.raises(AppError) as caught:
        await h.answers.ask(
            lane_command(
                h,
                chat,
                Lane.A,
                "claude-sonnet-5-5",
                client_id=str(uuid4()),
                comparison=str(uuid4()),
            )
        )
    assert caught.value.code is ErrorCode.CONCURRENCY_LIMIT
    h.registry.stop(busy.id)
    [_ async for _ in running.events()]
    assert h.registry.active == 0


async def test_one_failing_lane_leaves_the_other_alone(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    h.add_document(MIRA)
    chat = h.new_chat()
    client_id, comparison = str(uuid4()), str(uuid4())
    question = "Welche Schutzart hat die Mira? #fake:error_mid_stream@claude-haiku-4-5"
    runs = [
        await h.answers.ask(
            replace(
                lane_command(h, chat, lane, model, client_id=client_id, comparison=comparison),
                content=question,
            )
        )
        for lane, model in ((Lane.A, "claude-sonnet-5-5"), (Lane.B, "claude-haiku-4-5"))
    ]
    events_a = [e async for e in runs[0].events()]
    events_b = [e async for e in runs[1].events()]
    assert isinstance(events_a[-1], DoneEvent) and events_a[-1].status is MessageStatus.COMPLETE
    assert isinstance(events_b[-1], ErrorEvent)
    assert events_b[-1].code is ErrorCode.LLM_OVERLOADED and events_b[-1].partial


async def test_prefer_switches_the_kept_answer_and_the_history(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    h.add_document(MIRA)
    chat = h.new_chat()
    events_a, events_b = await compare(h, chat)
    a_id, b_id = meta(events_a).assistant_message_id, meta(events_b).assistant_message_id

    h.chats.prefer(chat.id, b_id)
    a, b = h.chats_repo.get_message(a_id), h.chats_repo.get_message(b_id)
    assert a is not None and b is not None
    assert (a.is_preferred, b.is_preferred) == (False, True)

    await h.ask(chat, "Und die Schlagfestigkeit?")
    assert h.llm is not None
    [turn] = h.llm.requests[-1].history
    assert turn.answer == b.content


async def test_prefer_survives_the_final_save_of_a_running_lane(tmp_path: Path) -> None:
    llm = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.01)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document(MIRA)
    chat = h.new_chat()
    client_id, comparison = str(uuid4()), str(uuid4())
    run_a = await h.answers.ask(
        lane_command(
            h, chat, Lane.A, "claude-sonnet-5-5", client_id=client_id, comparison=comparison
        )
    )
    run_b = await h.answers.ask(
        lane_command(
            h, chat, Lane.B, "claude-haiku-4-5", client_id=client_id, comparison=comparison
        )
    )
    events_b = [e async for e in run_b.events()]
    h.chats.prefer(chat.id, meta(events_b).assistant_message_id)  # lane a still streams
    events_a = [e async for e in run_a.events()]
    a = h.chats_repo.get_message(meta(events_a).assistant_message_id)
    assert a is not None and a.status is MessageStatus.COMPLETE and not a.is_preferred


async def test_prefer_needs_an_answer_of_a_comparison_in_this_chat(tmp_path: Path) -> None:
    h = build_chat_harness(tmp_path)
    h.add_document(MIRA)
    chat, other = h.new_chat(), h.new_chat()
    single = meta(await h.ask(chat)).assistant_message_id
    events_a, _ = await compare(h, chat)
    for chat_id, message_id in (
        (chat.id, single),
        (other.id, meta(events_a).assistant_message_id),
        (chat.id, str(uuid4())),
    ):
        with pytest.raises(AppError) as caught:
            h.chats.prefer(chat_id, message_id)
        assert caught.value.code is ErrorCode.NOT_FOUND
