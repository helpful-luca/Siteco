from pathlib import Path

import pytest

from docchat.adapters.fake_llm import FakeLLMClient, FakeScenario
from docchat.domain.enums import ChatScope, Lane, MessageRole, MessageStatus, TitleSource
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.run_events import DeltaEvent, DoneEvent
from tests.services.chat_support import ChatHarness, build_chat_harness


@pytest.fixture
def h(tmp_path: Path) -> ChatHarness:
    return build_chat_harness(tmp_path)


def test_create_with_all_or_selected_documents(h: ChatHarness) -> None:
    document = h.add_document()
    everything = h.chats.create(ChatScope.ALL)
    assert (everything.scope, everything.document_ids, everything.title) == (
        ChatScope.ALL,
        (),
        None,
    )
    focused = h.chats.create(ChatScope.SELECTED, [document.id, document.id])
    assert focused.document_ids == (document.id,)
    assert [s.chat.id for s in h.chats.list_chats()] == [focused.id, everything.id]


def test_selected_scope_needs_existing_documents(h: ChatHarness) -> None:
    with pytest.raises(AppError) as empty:
        h.chats.create(ChatScope.SELECTED, [])
    assert empty.value.code is ErrorCode.VALIDATION_ERROR
    with pytest.raises(AppError) as missing:
        h.chats.create(ChatScope.SELECTED, ["00000000-0000-4000-8000-000000000000"])
    assert missing.value.code is ErrorCode.NOT_FOUND


def test_chat_limit(h: ChatHarness) -> None:
    for _ in range(5):
        h.chats.create(ChatScope.ALL)
    with pytest.raises(AppError) as caught:
        h.chats.create(ChatScope.ALL)
    assert caught.value.code is ErrorCode.CHAT_LIMIT
    assert caught.value.params == {"max": 5}


async def test_renaming_makes_the_title_the_users(h: ChatHarness) -> None:
    h.add_document()
    chat = h.new_chat()
    renamed = h.chats.update(chat.id, title="  Mira\nDatenblatt ")
    assert (renamed.title, renamed.title_source) == ("Mira Datenblatt", TitleSource.USER)
    await h.ask(renamed)  # the first question must not overwrite a user title
    assert h.chats.get(chat.id).title == "Mira Datenblatt"
    with pytest.raises(AppError) as caught:
        h.chats.update(chat.id, title="   ")
    assert caught.value.code is ErrorCode.VALIDATION_ERROR


def test_scope_change(h: ChatHarness) -> None:
    document = h.add_document()
    chat = h.new_chat()
    narrowed = h.chats.update(chat.id, scope=ChatScope.SELECTED, document_ids=[document.id])
    assert narrowed.document_ids == (document.id,)
    widened = h.chats.update(chat.id, scope=ChatScope.ALL)
    assert (widened.scope, widened.document_ids) == (ChatScope.ALL, ())
    with pytest.raises(AppError) as caught:
        h.chats.update("missing", title="x")
    assert caught.value.code is ErrorCode.CHAT_NOT_FOUND


async def test_deleting_a_chat_stops_its_answer_first(tmp_path: Path) -> None:
    llm = FakeLLMClient([FakeScenario.SLOW], slow_delay_s=0.01)
    h = build_chat_harness(tmp_path, llm=llm)
    h.add_document()
    chat = h.new_chat()
    run = await h.answers.ask(h.command(chat))
    events = run.events()
    async for event in events:
        if isinstance(event, DeltaEvent):
            break
    await h.chats.delete(chat.id)
    assert h.registry.active == 0
    assert llm.cancelled == 1
    assert h.chats_repo.get_chat(chat.id) is None
    rest = [e async for e in events]
    assert isinstance(rest[-1], DoneEvent)  # the listener still gets its terminal event
    with pytest.raises(AppError) as caught:
        await h.chats.delete(chat.id)
    assert caught.value.code is ErrorCode.CHAT_NOT_FOUND


async def test_an_answer_stopped_before_its_task_ran_ends_cleanly(h: ChatHarness) -> None:
    h.add_document()
    chat = h.new_chat()
    run = await h.answers.ask(h.command(chat))
    assert h.registry.stop(chat.id) == [Lane.A]  # the task has not had a turn yet
    events = [e async for e in run.events()]
    assert [type(e).__name__ for e in events] == ["MetaEvent", "DoneEvent"]
    assert h.registry.active == 0
    assert h.llm is not None and h.llm.requests == []
    [answer] = [m for m in h.chats_repo.list_messages(chat.id) if m.role is MessageRole.ASSISTANT]
    assert answer.status is MessageStatus.STOPPED


async def test_messages_know_which_source_documents_still_exist(h: ChatHarness) -> None:
    kept = h.add_document()
    gone = h.add_document(("Die Luna hat IP65.",), filename="Luna.pdf")
    chat = h.new_chat()
    await h.ask(chat)
    h.documents.delete(gone.id)
    result = h.chats.messages(chat.id)
    assert [m.role for m in result.messages] == [MessageRole.USER, MessageRole.ASSISTANT]
    assert kept.id in result.existing_document_ids
    assert gone.id not in result.existing_document_ids


def test_recover_marks_leftover_streaming_answers(h: ChatHarness) -> None:
    from dataclasses import replace

    from docchat.domain.chat_models import Message

    chat = h.new_chat()
    h.chats_repo.insert_message(
        replace(
            Message("a1", chat.id, MessageRole.ASSISTANT, h.clock.now()),
            status=MessageStatus.STREAMING,
        )
    )
    assert h.chats.recover() == 1
    message = h.chats_repo.get_message("a1")
    assert message is not None and message.status is MessageStatus.INTERRUPTED
