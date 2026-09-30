import asyncio
import threading
from pathlib import Path

from docchat.domain.chunking import chunk_section
from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import ErrorCode, IngestionError, NoticeCode
from docchat.domain.models import Notice
from tests.fakes import FakeEmbedder, page
from tests.services.conftest import Harness, build_harness

TEXT = "Die Leuchte ist hell. Sie hat IP66 und 5000 Lumen."


async def _wait_idle(harness: Harness) -> None:
    async with asyncio.timeout(10):
        while not harness.worker.idle:
            await asyncio.sleep(0.01)


async def test_pdf_goes_from_queued_to_ready(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT, "", TEXT, TEXT, TEXT])
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None
    assert ready.status is DocumentStatus.READY
    assert (ready.page_count, ready.chunk_count, ready.progress) == (5, 4, 1.0)
    assert ready.char_count == 4 * len(TEXT)
    assert ready.notices == (Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": 1}),)
    assert ready.ready_at is not None
    assert harness.vectors.count(doc.id) == 4
    assert harness.vectors.optimized == 1
    assert [call[1:] for call in harness.pdf.calls] == [(0, 2), (2, 2), (4, 1)]
    assert not (harness.root / "spool" / f"{doc.id}.jsonl").exists()


async def test_chunks_carry_page_numbers_and_ordinals(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT, TEXT])
    await harness.worker.process(doc.id)
    chunks = sorted((c for c, _ in harness.vectors.rows.values()), key=lambda c: c.ordinal)
    assert [(c.ordinal, c.page) for c in chunks] == [(0, 1), (1, 2)]
    assert chunks[0].search_text.startswith(f"Dokument: {doc.filename} / Seite 1\n")


async def test_markdown_document_uses_headings(harness: Harness) -> None:
    content = b"# Technik\nSchutzart IP66.\n\n# Montage\nAm Mast montieren."
    doc = harness.add_document(DocumentKind.MD, content=content)
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None and ready.status is DocumentStatus.READY
    assert ready.page_count is None
    headings = sorted(c.heading for c, _ in harness.vectors.rows.values())
    assert headings == ["Montage", "Technik"]


async def test_parser_errors_fail_the_document_and_keep_the_file(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT])
    harness.pdf.open_error[f"{doc.id}.pdf"] = IngestionError(ErrorCode.PDF_ENCRYPTED)
    await harness.worker.process(doc.id)
    failed = harness.reload(doc)
    assert failed is not None
    assert (failed.status, failed.error_code) == (DocumentStatus.FAILED, ErrorCode.PDF_ENCRYPTED)
    assert harness.storage.exists(doc.id, DocumentKind.PDF)


async def test_page_limit(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, max_pdf_pages=3)
    doc = harness.add_document(pages=[TEXT] * 4)
    await harness.worker.process(doc.id)
    assert harness.reload(doc).error_code is ErrorCode.PDF_TOO_MANY_PAGES  # type: ignore[union-attr]
    assert harness.pdf.calls == []  # rejected before any page is parsed


async def test_character_limit(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, max_chars=len(TEXT) * 2)
    doc = harness.add_document(pages=[TEXT] * 3)
    await harness.worker.process(doc.id)
    assert harness.reload(doc).error_code is ErrorCode.DOCUMENT_TOO_LONG  # type: ignore[union-attr]
    assert harness.vectors.count(doc.id) == 0


async def test_scanned_pdf_without_any_text(harness: Harness) -> None:
    doc = harness.add_document(pages=["", "  ", "12"])
    await harness.worker.process(doc.id)
    assert harness.reload(doc).error_code is ErrorCode.PDF_NO_TEXT  # type: ignore[union-attr]


async def test_a_failed_batch_skips_only_its_pages(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT] * 6)
    harness.pdf.failing_batches[f"{doc.id}.pdf"] = {2: True}
    await harness.worker.process(doc.id)
    ready = harness.reload(doc)
    assert ready is not None and ready.status is DocumentStatus.READY
    assert ready.chunk_count == 4
    assert ready.notices == (Notice(NoticeCode.PAGES_SKIPPED, {"count": 2}),)


async def test_too_many_failed_batches_fail_the_document(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT] * 8)
    harness.pdf.failing_batches[f"{doc.id}.pdf"] = {0: False, 2: True, 4: True}
    await harness.worker.process(doc.id)
    failed = harness.reload(doc)
    assert failed is not None and failed.error_code is ErrorCode.PROCESSING_TIMEOUT
    assert (6, 2) not in [c[1:] for c in harness.pdf.calls]


async def test_embedding_failure_leaves_nothing_in_the_index(tmp_path: Path) -> None:
    harness = build_harness(tmp_path, embedder=FakeEmbedder(dim=4, fail_on_call=3))
    doc = harness.add_document(pages=[TEXT] * 8)
    await harness.worker.process(doc.id)
    failed = harness.reload(doc)
    assert failed is not None and failed.error_code is ErrorCode.PROCESSING_FAILED
    assert harness.vectors.count(doc.id) == 0


async def test_restart_of_a_document_replaces_old_chunks(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT])
    [stale] = chunk_section(page(1, TEXT), document_id=doc.id, document_name="x", first_ordinal=0)
    harness.vectors.add([stale], [[0.0] * 4])  # written before a crash in the embed pass
    await harness.worker.process(doc.id)
    assert harness.vectors.count(doc.id) == 1
    assert stale.chunk_id not in harness.vectors.rows


async def test_only_queued_documents_are_processed(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT], status=DocumentStatus.FAILED)
    await harness.worker.process(doc.id)
    await harness.worker.process("unknown")
    assert harness.pdf.calls == []


async def test_delete_during_parsing_wins(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT] * 6)
    in_batch = asyncio.Event()
    release = asyncio.Event()

    async def pause(name: str, first: int) -> None:
        if first == 2:
            in_batch.set()
            await release.wait()

    harness.pdf.before_batch = pause
    task = asyncio.create_task(harness.worker.process(doc.id))
    await in_batch.wait()
    await harness.documents.delete(doc.id)
    release.set()
    await task
    assert harness.reload(doc) is None
    assert harness.vectors.count(doc.id) == 0
    assert not harness.storage.exists(doc.id, DocumentKind.PDF)
    assert (0, 2) in [c[1:] for c in harness.pdf.calls]
    assert (4, 2) not in [c[1:] for c in harness.pdf.calls]  # stopped after the delete
    assert not list((harness.root / "spool").glob("*.jsonl"))


async def test_delete_during_embedding_removes_late_writes(harness: Harness) -> None:
    doc = harness.add_document(pages=[TEXT] * 6)
    gate = threading.Event()
    harness.embedder.gate = gate
    task = asyncio.create_task(harness.worker.process(doc.id))
    while harness.embedder.calls == 0:
        await asyncio.sleep(0.01)
    await harness.documents.delete(doc.id)
    gate.set()
    await task
    assert harness.reload(doc) is None
    assert harness.vectors.count(doc.id) == 0


async def test_queue_prefers_small_documents(harness: Harness) -> None:
    big = harness.add_document(pages=[TEXT] * 3, size_bytes=50_000_000)
    small = harness.add_document(pages=[TEXT], size_bytes=10_000)
    harness.worker.enqueue(harness.reload(big))  # type: ignore[arg-type]
    harness.worker.enqueue(harness.reload(small))  # type: ignore[arg-type]
    assert harness.worker.queue_positions() == {small.id: 1, big.id: 2}
    assert harness.documents.get(big.id).queue_position == 2
    harness.worker.start()
    try:
        await _wait_idle(harness)
    finally:
        await harness.worker.stop()
    order = [name for name, _, _ in harness.pdf.calls]
    assert order[0] == f"{small.id}.pdf"
    assert harness.reload(big).status is DocumentStatus.READY  # type: ignore[union-attr]


async def test_recovery_after_a_crash(harness: Harness) -> None:
    interrupted = harness.add_document(pages=[TEXT])
    harness.repository.start_parsing(interrupted.id, harness.clock.now())
    queued = harness.add_document(pages=[TEXT])
    deleting = harness.add_document(pages=[TEXT])
    harness.repository.mark_deleting(deleting.id, harness.clock.now())
    ready = harness.add_document(pages=[TEXT])
    await harness.worker.process(ready.id)
    orphan_file = harness.storage.path_for("0" * 8, DocumentKind.PDF)
    orphan_file.write_bytes(b"left over")
    leftover = harness.storage.new_upload()
    leftover.write(b"half an upload")
    harness.spool.writer("stale").close()
    [ghost] = chunk_section(page(1, TEXT), document_id="ghost", document_name="x", first_ordinal=0)
    harness.vectors.add([ghost], [[0.0] * 4])

    await harness.worker.recover()

    assert harness.reload(interrupted).status is DocumentStatus.QUEUED  # type: ignore[union-attr]
    assert harness.reload(deleting) is None
    assert not harness.storage.exists(deleting.id, DocumentKind.PDF)
    assert not orphan_file.exists()
    assert not leftover.path.exists()
    assert not (harness.root / "spool").exists()
    assert harness.vectors.count("ghost") == 0
    assert harness.vectors.count(ready.id) == 1
    assert set(harness.worker.queue_positions()) == {interrupted.id, queued.id}
    harness.worker.start()
    try:
        await _wait_idle(harness)
    finally:
        await harness.worker.stop()
    assert harness.reload(interrupted).status is DocumentStatus.READY  # type: ignore[union-attr]
    assert harness.reload(queued).status is DocumentStatus.READY  # type: ignore[union-attr]


async def test_a_failing_recovery_step_does_not_stop_the_others(harness: Harness) -> None:
    queued = harness.add_document(pages=[TEXT])
    deleting = harness.add_document(pages=[TEXT])
    harness.repository.mark_deleting(deleting.id, harness.clock.now())

    def broken(document_id: str) -> None:
        raise OSError("index unavailable")

    harness.vectors.delete_document = broken  # type: ignore[method-assign]
    await harness.worker.recover()
    assert harness.worker.queue_positions() == {queued.id: 1}
    assert harness.reload(deleting).status is DocumentStatus.DELETING  # type: ignore[union-attr]
