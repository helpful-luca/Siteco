"""Priority queue for the ingestion worker: small documents overtake large ones.

The priority is the page count. Uploads never open a PDF (that only happens in the parser
process), so until the pages are counted the size of the file stands in for it.
"""

import asyncio
import heapq
import itertools
import math

from docchat.domain.enums import DocumentKind
from docchat.domain.models import Document

# Rough bytes per page, only used to order the queue before the real page count is known.
_BYTES_PER_PAGE = {DocumentKind.PDF: 100_000, DocumentKind.TXT: 3_000, DocumentKind.MD: 3_000}


def queue_priority(document: Document) -> int:
    if document.page_count:
        return document.page_count
    return max(1, math.ceil(document.size_bytes / _BYTES_PER_PAGE[document.kind]))


class IngestionQueue:
    def __init__(self) -> None:
        self._heap: list[tuple[int, int, str]] = []
        self._order = itertools.count()
        self._not_empty = asyncio.Event()

    def put(self, document: Document) -> None:
        if document.id in self:
            return
        heapq.heappush(self._heap, (queue_priority(document), next(self._order), document.id))
        self._not_empty.set()

    def discard(self, document_id: str) -> None:
        remaining = [entry for entry in self._heap if entry[2] != document_id]
        if len(remaining) != len(self._heap):
            heapq.heapify(remaining)
            self._heap = remaining

    async def get(self) -> str:
        while not self._heap:
            self._not_empty.clear()
            await self._not_empty.wait()
        return heapq.heappop(self._heap)[2]

    def positions(self) -> dict[str, int]:
        """1-based position of every waiting document. Safe to call from a worker thread."""
        return {entry[2]: i for i, entry in enumerate(sorted(list(self._heap)), start=1)}

    def __contains__(self, document_id: object) -> bool:
        return any(entry[2] == document_id for entry in list(self._heap))

    def __len__(self) -> int:
        return len(self._heap)
