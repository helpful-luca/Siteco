from dataclasses import replace
from datetime import UTC, datetime

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.models import Document
from docchat.services.ingestion_queue import MAX_OVERTAKES, IngestionQueue

T0 = datetime(2026, 9, 30, tzinfo=UTC)


def _doc(doc_id: str, pages: int) -> Document:
    return Document(
        id=doc_id,
        filename=f"{doc_id}.pdf",
        kind=DocumentKind.PDF,
        size_bytes=1,
        sha256=doc_id,
        status=DocumentStatus.QUEUED,
        created_at=T0,
        updated_at=T0,
        page_count=pages,
    )


async def test_smaller_documents_go_first() -> None:
    queue = IngestionQueue()
    queue.put(_doc("big", 1500))
    queue.put(_doc("small", 1))
    queue.put(_doc("mid", 40))
    assert queue.positions() == {"small": 1, "mid": 2, "big": 3}
    assert [await queue.get() for _ in range(3)] == ["small", "mid", "big"]


async def test_a_large_document_is_overtaken_only_a_few_times() -> None:
    queue = IngestionQueue()
    queue.put(_doc("catalog", 1500))
    served = []
    for n in range(MAX_OVERTAKES + 3):
        queue.put(_doc(f"sheet{n}", 1))  # a steady stream of small uploads
        served.append(await queue.get())
    assert served.index("catalog") == MAX_OVERTAKES


async def test_positions_predict_the_serving_order_with_aging() -> None:
    queue = IngestionQueue()
    queue.put(_doc("catalog", 1500))
    for n in range(MAX_OVERTAKES):
        queue.put(_doc(f"a{n}", 1))
        await queue.get()
    queue.put(_doc("late", 1))
    positions = queue.positions()
    order = [await queue.get() for _ in range(len(positions))]
    assert order == sorted(positions, key=positions.__getitem__)
    assert order[0] == "catalog"


async def test_duplicates_and_discard() -> None:
    queue = IngestionQueue()
    doc = _doc("a", 3)
    queue.put(doc)
    queue.put(replace(doc, page_count=1))
    assert len(queue) == 1
    queue.discard("a")
    assert len(queue) == 0 and "a" not in queue


def test_every_kind_has_a_size_estimate() -> None:
    from docchat.services.ingestion_queue import queue_priority

    now = datetime(2026, 10, 1, tzinfo=UTC)
    for kind in DocumentKind:
        document = Document("d", "a", kind, 50_000, "s", DocumentStatus.QUEUED, now, now)
        assert queue_priority(document) >= 1
