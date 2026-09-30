"""Delete everything, statistics, retention and export against real SQLite, files and spool."""

import asyncio
import io
import json
import zipfile
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest

from docchat.adapters.directory_size_meter import DirectorySizeMeter
from docchat.adapters.sqlite.preferences_store import SqlitePreferencesStore
from docchat.adapters.sqlite.usage_ledger import SqliteUsageLedger
from docchat.domain.chat_models import Chat, Citation, Message, SourceSnapshot
from docchat.domain.enums import ChatScope, DocumentKind, DocumentStatus, Lane, MessageRole
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.models import Chunk, Document
from docchat.services.chat_service import ChatService
from docchat.services.disk_erasure import DiskErasure
from docchat.services.limits import DailyBudget
from docchat.services.preferences_service import PreferencesService
from docchat.services.retention_sweeper import RetentionSweeper
from docchat.services.run_registry import RunRegistry
from docchat.services.workspace_export import WorkspaceExport
from docchat.services.workspace_service import WorkspaceParts, WorkspaceService
from tests.services.conftest import Harness

MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5")


class World:
    def __init__(self, harness: Harness, *, retention_days: int = 0) -> None:
        self.h = harness
        self.runs = RunRegistry(3)
        self.ledger = SqliteUsageLedger(harness.database)
        self.preferences = PreferencesService(
            SqlitePreferencesStore(harness.database), harness.clock, MODELS, "claude-sonnet-5-5"
        )
        self.erasure = DiskErasure(harness.vectors, harness.database)
        self.chat_service = ChatService(
            harness.chats,
            harness.repository,
            self.runs,
            harness.clock,
            self.erasure,
            max_chats=100,
        )
        self.workspace = WorkspaceService(
            WorkspaceParts(
                chats=harness.chats,
                documents=harness.repository,
                library=harness.documents,
                storage=harness.storage,
                vectors=harness.vectors,
                runs=self.runs,
                preferences=self.preferences,
                meter=DirectorySizeMeter(harness.root),
                erasure=self.erasure,
                ledger=self.ledger,
                budget=DailyBudget(self.ledger, harness.clock, None),
                clock=harness.clock,
            ),
            retention_days=retention_days,
        )
        self.sweeper = RetentionSweeper(
            self.chat_service, harness.chats, harness.repository, harness.documents,
            self.erasure, harness.clock, days=retention_days,
        )  # fmt: skip
        self.export = WorkspaceExport(
            harness.chats,
            harness.repository,
            self.preferences,
            harness.clock,
            tmp_dir=harness.root / "tmp",
        )

    def document(self, status: DocumentStatus = DocumentStatus.READY) -> Document:
        document = self.h.add_document(DocumentKind.TXT, content=b"Die Mira hat IP66.")
        with self.h.database.connect() as conn:
            conn.execute("UPDATE documents SET status = ? WHERE id = ?", (status, document.id))
        chunk_id = str(uuid4())
        chunk = Chunk(chunk_id, document.id, 0, None, "", "Die Mira hat IP66.", "x", ())
        self.h.vectors.add([chunk], [[0.0] * 4])
        return document

    def chat_citing(self, document: Document, *, age_days: int = 0) -> str:
        chat_id = str(uuid4())
        when = self.h.clock.now() - timedelta(days=age_days)
        self.h.chats.insert_chat(Chat(chat_id, ChatScope.ALL, when, when, title="Schutzart?"))
        source = SourceSnapshot("s1", 1, document.id, document.filename, None, "Die Mira hat IP66.")
        self.h.chats.insert_messages(
            [
                Message(f"u-{chat_id}", chat_id, MessageRole.USER, when, content="Schutzart?"),
                Message(
                    f"a-{chat_id}",
                    chat_id,
                    MessageRole.ASSISTANT,
                    when,
                    parent_id=f"u-{chat_id}",
                    content="IP66.",
                    sources=(source,),
                    citations=(Citation("s1", 0, 1, "Die Mira hat IP66.", 5),),
                ),
            ]
        )
        return chat_id


@pytest.fixture
def world(harness: Harness) -> World:
    return World(harness)


def _files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()]


async def test_delete_everything_leaves_no_file_vector_or_row(world: World) -> None:
    ready = world.document()
    world.document(DocumentStatus.QUEUED)
    world.document(DocumentStatus.FAILED)
    world.chat_citing(ready)
    world.preferences.update(replace(world.preferences.get(), name="Luca", onboarded=True))
    quarantined = world.h.storage.quarantined_path(str(uuid4()), DocumentKind.PDF)
    quarantined.parent.mkdir(parents=True, exist_ok=True)
    quarantined.write_bytes(b"%PDF")
    orphan = world.h.storage.path_for(str(uuid4()), DocumentKind.PDF)
    orphan.write_bytes(b"%PDF")

    await world.workspace.wipe(reset_preferences=False)

    assert world.h.repository.all_ids() == set()
    assert world.h.chats.list_chats() == []
    assert world.h.vectors.rows == {}
    assert _files(world.h.root / "uploads") == []
    assert _files(world.h.root / "quarantine") == []
    with world.h.database.connect() as conn:
        for table in ("documents", "chats", "messages", "chat_documents"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table
    assert world.preferences.get().name == "Luca"  # kept unless asked
    assert world.h.vectors.purged == 1  # once for the whole wipe, not per document


async def test_delete_everything_can_reset_the_preferences(world: World) -> None:
    world.preferences.update(replace(world.preferences.get(), name="Luca", onboarded=True))
    await world.workspace.wipe(reset_preferences=True)
    prefs = world.preferences.get()
    assert prefs.name == "" and not prefs.onboarded


async def test_delete_everything_stops_running_answers_first(world: World) -> None:
    chat_id = world.chat_citing(world.document())
    control = world.runs.reserve(chat_id, Lane.A)

    async def answer_notices_the_stop() -> None:
        while control.stop_reason is None:
            await asyncio.sleep(0.001)
        world.runs.release(control)

    await asyncio.gather(world.workspace.wipe(reset_preferences=False), answer_notices_the_stop())
    assert world.runs.active == 0
    assert world.h.chats.list_chats() == []


async def test_statistics(world: World) -> None:
    ready = world.document()
    world.chat_citing(ready)
    world.ledger.record(world.h.clock.now().date().isoformat(), 0.25, 1000, 100)
    stats = await world.workspace.stats()
    assert (stats.documents, stats.chats) == (1, 1)
    assert stats.documents_bytes == ready.size_bytes
    assert stats.storage_bytes > 0
    assert stats.usage_today.cost_usd == 0.25 and stats.usage_today.requests == 1
    assert stats.retention_days is None


async def test_deleting_a_document_redacts_the_answers_that_cited_it(world: World) -> None:
    document = world.document()
    chat_id = world.chat_citing(document)
    await world.h.documents.delete(document.id)
    [_, answer] = world.h.chats.list_messages(chat_id)
    assert answer.sources[0].snippet == "" and answer.citations[0].cited_text == ""
    assert answer.sources[0].filename == document.filename
    assert world.h.vectors.purged == 1


async def test_startup_redacts_snapshots_of_documents_already_gone(world: World) -> None:
    document = world.document()
    chat_id = world.chat_citing(document)
    world.h.repository.delete(document.id)  # gone without a purge (older release, crash)
    await world.workspace.recover()
    [_, answer] = world.h.chats.list_messages(chat_id)
    assert answer.citations[0].cited_text == ""


# Retention


async def test_retention_deletes_old_chats_and_documents_only(harness: Harness) -> None:
    world = World(harness, retention_days=30)
    old_document = world.document()
    with harness.database.connect() as conn:
        old = (harness.clock.now() - timedelta(days=31)).isoformat()
        conn.execute("UPDATE documents SET created_at = ? WHERE id = ?", (old, old_document.id))
    new_document = world.document()
    old_chat = world.chat_citing(new_document, age_days=31)
    busy_chat = world.chat_citing(new_document, age_days=40)
    new_chat = world.chat_citing(new_document, age_days=2)
    control = world.runs.reserve(busy_chat, Lane.A)

    result = await world.sweeper.sweep_once()

    assert (result.chats, result.documents) == (1, 1)
    remaining = {s.chat.id for s in harness.chats.list_chats()}
    assert remaining == {busy_chat, new_chat} and old_chat not in remaining
    assert harness.repository.all_ids() == {new_document.id}
    assert harness.vectors.purged == 1
    world.runs.release(control)


async def test_retention_later_on_the_fake_clock(harness: Harness) -> None:
    world = World(harness, retention_days=7)
    chat_id = world.chat_citing(world.document())
    assert (await world.sweeper.sweep_once()).chats == 0
    harness.clock.current += timedelta(days=8)
    assert (await world.sweeper.sweep_once()).chats == 1
    assert harness.chats.get_chat(chat_id) is None


async def test_retention_off_does_nothing(harness: Harness) -> None:
    world = World(harness, retention_days=0)
    world.chat_citing(world.document(), age_days=4000)
    assert (await world.sweeper.sweep_once()).chats == 0
    assert len(harness.chats.list_chats()) == 1


# Export


async def test_export_holds_chats_preferences_and_the_document_list(world: World) -> None:
    document = world.document()
    world.chat_citing(document)
    world.chat_citing(document)
    world.preferences.update(replace(world.preferences.get(), name="Luca", onboarded=True))

    chunks, handle = await world.export.build()
    archive = zipfile.ZipFile(io.BytesIO(b"".join(chunks)))
    assert handle.closed
    names = archive.namelist()
    assert "preferences.json" in names and "documents.json" in names
    chats = sorted(n for n in names if n.startswith("chats/"))
    assert chats == [
        "chats/001-schutzart.json", "chats/001-schutzart.md",
        "chats/002-schutzart.json", "chats/002-schutzart.md",
    ]  # fmt: skip
    for name in names:
        assert not name.startswith("/") and ".." not in name and "\\" not in name
    assert json.loads(archive.read("preferences.json"))["name"] == "Luca"
    [listed] = json.loads(archive.read("documents.json"))["documents"]
    assert listed["filename"] == document.filename
    record = json.loads(archive.read(chats[0]))
    assert record["messages"][1]["citations"][0]["cited_text"] == "Die Mira hat IP66."
    assert "Schutzart?" in archive.read(chats[1]).decode()
    assert all(not n.startswith("documents/") for n in names)  # no document files


async def test_retention_never_deletes_a_chat_whose_answer_starts_meanwhile(world: World) -> None:
    chat_id = world.chat_citing(world.document(), age_days=400)
    assert world.runs.close_if_idle(chat_id)
    with pytest.raises(AppError) as caught:
        world.runs.reserve(chat_id, Lane.A)  # an answer arriving while it is being deleted
    assert caught.value.code is ErrorCode.CHAT_NOT_FOUND
    world.runs.reopen(chat_id)
    control = world.runs.reserve(chat_id, Lane.A)
    assert not await world.chat_service.delete_if_idle(chat_id)
    world.runs.release(control)
    assert await world.chat_service.delete_if_idle(chat_id)


async def test_a_busy_log_is_emptied_later(harness: Harness) -> None:
    class BusyOnce:
        def __init__(self) -> None:
            self.calls = 0

        def vacuum(self) -> None: ...

        def checkpoint(self) -> bool:
            self.calls += 1
            return self.calls > 1

    database = BusyOnce()
    erasure = DiskErasure(harness.vectors, database, retry_every_s=0.01)
    await erasure.after_rows()
    assert erasure.log_pending
    for _ in range(100):
        if not erasure.log_pending:
            break
        await asyncio.sleep(0.01)
    assert not erasure.log_pending and database.calls == 2
    await erasure.stop()


async def test_an_aborted_export_leaves_nothing_behind(world: World) -> None:
    world.chat_citing(world.document())
    chunks, handle = await world.export.build()
    next(chunks)  # the download started, then the client went away
    handle.close()
    assert [p for p in (world.h.root / "tmp").iterdir()] == []
