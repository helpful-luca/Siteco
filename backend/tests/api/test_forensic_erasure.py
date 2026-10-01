"""Deleted content must be gone from the disk, not only from the API.

A document carries a unique marker. It is indexed, cited in an answer (snippet and index),
then removed by a document delete, a workspace wipe or the retention sweep. Afterwards every
file below the data directory is read as raw bytes: the marker may appear nowhere."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from docchat.adapters.fake_llm import FakeLLMClient
from docchat.adapters.system_clock import SystemClock
from docchat.core.config import Settings
from tests.api.test_chat_attachments import attach
from tests.api.test_chats import add_document, ask, new_chat
from tests.api.test_documents import wait_until_settled
from tests.support import make_app

MARKER = "ZX-GDPR-7731"
# The first sentence is what the fake model cites (and quotes in its answer); the marker sits in
# the same chunk, so it lives in the file, the index, the snippet snapshot, not in the answer.
DOCUMENT = (
    "# Mira\n\nDie Leuchte Mira hat die Schutzart IP66 und ist schlagfest. "
    f"Interne Kennung {MARKER}.\n"
)
ENCODINGS = ("utf-8", "utf-16-le")


class JumpClock(SystemClock):
    def __init__(self) -> None:
        self.offset = timedelta(0)

    def now(self) -> datetime:
        return datetime.now(UTC) + self.offset


def marker_files(root: Path) -> list[str]:
    needles = [MARKER.encode(e) for e in ENCODINGS] + [MARKER.lower().encode()]
    hits = []
    for path in root.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            if any(needle in data for needle in needles):
                hits.append(str(path.relative_to(root)))
    return sorted(hits)


@pytest.fixture
def clock() -> JumpClock:
    return JumpClock()


@pytest.fixture
def client(settings: Settings, clock: JumpClock) -> Iterator[TestClient]:
    app = make_app(
        settings.model_copy(update={"retention_days": 30}), llm=FakeLLMClient(), clock=clock
    )
    with TestClient(app) as c:
        yield c


def cited(client: TestClient, settings: Settings) -> tuple[str, str]:
    document_id = add_document(client, DOCUMENT, "kennung.md")
    chat_id = new_chat(client)
    r, _ = ask(client, chat_id, content="Welche Schutzart hat die Mira?")
    assert r.status_code == 200
    answer: dict[str, Any] = client.get(f"/api/chats/{chat_id}/messages").json()["messages"][1]
    assert MARKER in answer["sources"][0]["snippet"]
    assert MARKER not in answer["content"]
    hits = marker_files(settings.data_dir)
    assert any(h.startswith("uploads") for h in hits)
    assert any(h.startswith("lancedb") for h in hits)
    return document_id, chat_id


def test_document_delete_leaves_no_trace(client: TestClient, settings: Settings) -> None:
    document_id, chat_id = cited(client, settings)
    assert client.delete(f"/api/documents/{document_id}").status_code == 204
    assert marker_files(settings.data_dir) == []
    answer = client.get(f"/api/chats/{chat_id}/messages").json()["messages"][1]
    assert answer["sources"][0]["deleted"] is True  # the chat itself stays


def test_workspace_wipe_leaves_no_trace(client: TestClient, settings: Settings) -> None:
    cited(client, settings)
    assert client.delete("/api/workspace").status_code == 204
    assert marker_files(settings.data_dir) == []


async def test_retention_leaves_no_trace(
    client: TestClient, settings: Settings, clock: JumpClock
) -> None:
    cited(client, settings)
    clock.offset = timedelta(days=31)
    container = client.app.state.container  # type: ignore[attr-defined]
    result = await container.retention.sweep_once()
    assert (result.chats, result.documents) == (1, 1)
    assert marker_files(settings.data_dir) == []


def test_chat_delete_leaves_no_trace_of_its_attachments(
    client: TestClient, settings: Settings
) -> None:
    chat_id = new_chat(client)
    document_id = attach(client, chat_id, "kennung.md", DOCUMENT.encode()).json()["document"]["id"]
    assert wait_until_settled(client, document_id)["status"] == "ready"
    r, _ = ask(client, chat_id, content="Welche Schutzart hat die Mira?")
    assert r.status_code == 200
    hits = marker_files(settings.data_dir)
    assert any(h.startswith("uploads") for h in hits)
    assert any(h.startswith("lancedb") for h in hits)
    assert client.delete(f"/api/chats/{chat_id}").status_code == 204
    assert marker_files(settings.data_dir) == []
