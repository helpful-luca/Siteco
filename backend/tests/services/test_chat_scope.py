"""Which documents a chat searches: its own attachments plus its library scope."""

from pathlib import Path

import pytest

from docchat.domain.chat_models import Chat
from docchat.domain.enums import ChatScope
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.retrieval_service import RetrievalService, RetrievalSettings
from tests.fakes import FakeEmbedder
from tests.services.chat_support import ChatHarness, build_chat_harness


@pytest.fixture
def h(tmp_path: Path) -> ChatHarness:
    return build_chat_harness(tmp_path)


def _scope(h: ChatHarness, chat: Chat) -> set[str]:
    retrieval = RetrievalService(h.documents, h.vectors, FakeEmbedder(dim=4), RetrievalSettings())
    current = h.chats.get(chat.id)
    return {d.filename for d in retrieval.plan(current).documents}


def test_scope_all_is_the_library_plus_own_attachments(h: ChatHarness) -> None:
    chat, other = h.new_chat(), h.new_chat()
    h.add_document(filename="Bibliothek.pdf")
    h.add_document(filename="eigene.pdf", attach_to=chat.id)
    h.add_document(filename="fremde.pdf", attach_to=other.id)
    assert _scope(h, chat) == {"Bibliothek.pdf", "eigene.pdf"}
    assert _scope(h, other) == {"Bibliothek.pdf", "fremde.pdf"}


def test_scope_selected_is_the_selection_plus_own_attachments(h: ChatHarness) -> None:
    picked = h.add_document(filename="gewählt.pdf")
    h.add_document(filename="nicht gewählt.pdf")
    chat = h.new_chat(ChatScope.SELECTED, [picked.id])
    h.add_document(filename="eigene.pdf", attach_to=chat.id)
    assert _scope(h, chat) == {"gewählt.pdf", "eigene.pdf"}


def test_attachments_alone_are_enough_to_answer(h: ChatHarness) -> None:
    chat = h.new_chat()
    with pytest.raises(AppError) as caught:
        _scope(h, chat)
    assert caught.value.code is ErrorCode.NO_DOCUMENTS
    h.add_document(filename="eigene.pdf", attach_to=chat.id)
    assert _scope(h, chat) == {"eigene.pdf"}


def test_a_promoted_attachment_is_in_every_chat(h: ChatHarness) -> None:
    chat, other = h.new_chat(), h.new_chat()
    attachment = h.add_document(filename="eigene.pdf", attach_to=chat.id)
    assert h.documents.add_to_library(attachment.id, h.clock.now())
    assert _scope(h, other) == {"eigene.pdf"}
