"""Embed pass: chunks from the spool -> vectors -> LanceDB, in batches with flat memory."""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

from docchat.domain.models import Chunk, Document
from docchat.domain.ports import ChunkSpool, Embedder, VectorStore
from docchat.services.ingestion_progress import ProgressReporter


@dataclass(frozen=True)
class EmbedBatching:
    embed_batch_size: int  # chunks per embedder call
    write_batch_size: int  # chunks per LanceDB write (fewer, larger fragments)


class EmbedStage:
    def __init__(
        self,
        spool: ChunkSpool,
        embedder: Embedder,
        vectors: VectorStore,
        batching: EmbedBatching,
    ) -> None:
        self._spool = spool
        self._embedder = embedder
        self._vectors = vectors
        self._batching = batching

    async def _write(self, chunks: Sequence[Chunk], vectors: Sequence[Sequence[float]]) -> None:
        if chunks:
            await asyncio.to_thread(self._vectors.add, chunks, vectors)

    async def run(self, document: Document, chunk_count: int, report: ProgressReporter) -> None:
        reader = await asyncio.to_thread(self._spool.reader, document.id)
        pending: list[Chunk] = []
        pending_vectors: list[list[float]] = []
        done = 0
        try:
            while chunks := await asyncio.to_thread(reader.read, self._batching.embed_batch_size):
                texts = [c.search_text for c in chunks]
                pending_vectors += await asyncio.to_thread(self._embedder.embed_documents, texts)
                pending += chunks
                done += len(chunks)
                if len(pending) >= self._batching.write_batch_size:
                    await self._write(pending, pending_vectors)
                    pending, pending_vectors = [], []
                await report(done / max(1, chunk_count))
            await self._write(pending, pending_vectors)
        finally:
            await asyncio.to_thread(reader.close)
