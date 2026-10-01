import asyncio
from collections.abc import AsyncIterator

from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.domain.enums import ComponentStatus, DocumentStatus
from tests.fakes import FakeEmbedder, FakeScanner


async def _body(data: bytes) -> AsyncIterator[bytes]:
    yield data


async def test_scanning_works_even_if_the_embedder_failed(settings: Settings) -> None:
    container = build_container(settings, embedder=FakeEmbedder(fail=True), scanner=FakeScanner())
    await container.start()
    try:
        assert container.embedder_status is ComponentStatus.FAILED
        data = b"Die Leuchte hat 5000 Lumen."
        doc = await container.uploads.accept("a.txt", len(data), _body(data))
        async with asyncio.timeout(5):
            while True:
                current = await asyncio.to_thread(container.documents.get, doc.id)
                if current.document.status is DocumentStatus.QUEUED:
                    break
                await asyncio.sleep(0.01)
    finally:
        await container.stop()
