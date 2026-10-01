"""Priority queue for the ingestion worker: small documents overtake large ones, a few times.

The priority is the page count. Uploads never open a PDF (that only happens in the parser
process), so until the pages are counted the size of the file stands in for it. To keep a steady
stream of small uploads from starving a catalog, a document that has been overtaken
MAX_OVERTAKES times is served next. Queues are short, so a plain list is fine.
"""

import asyncio
import itertools
import math
from dataclasses import dataclass

from docchat.domain.enums import DocumentKind
from docchat.domain.models import Document

MAX_OVERTAKES = 5
# Rough bytes per page, only used to order the queue before the real page count is known.
# HTML carries markup around its text. Every kind needs an entry (a test checks it).
_BYTES_PER_PAGE = {
    DocumentKind.PDF: 100_000,
    DocumentKind.TXT: 3_000,
    DocumentKind.MD: 3_000,
    DocumentKind.HTML: 12_000,
}


def queue_priority(document: Document) -> int:
    if document.page_count:
        return document.page_count
    return max(1, math.ceil(document.size_bytes / _BYTES_PER_PAGE[document.kind]))


@dataclass
class _Entry:
    priority: int
    arrival: int
    document_id: str
    overtaken: int = 0


def _next_index(entries: list[_Entry]) -> int:
    """The entry to serve next: the longest-overtaken one if it waited enough, else the smallest."""
    starving = [i for i, e in enumerate(entries) if e.overtaken >= MAX_OVERTAKES]
    if starving:
        return min(starving, key=lambda i: entries[i].arrival)
    return min(range(len(entries)), key=lambda i: (entries[i].priority, entries[i].arrival))


def _pop(entries: list[_Entry]) -> _Entry:
    chosen = entries.pop(_next_index(entries))
    for entry in entries:
        if entry.arrival < chosen.arrival:
            entry.overtaken += 1
    return chosen


class IngestionQueue:
    def __init__(self) -> None:
        self._entries: list[_Entry] = []
        self._arrivals = itertools.count()
        self._not_empty = asyncio.Event()

    def put(self, document: Document) -> None:
        if document.id in self:
            return
        self._entries.append(_Entry(queue_priority(document), next(self._arrivals), document.id))
        self._not_empty.set()

    def discard(self, document_id: str) -> None:
        self._entries = [e for e in self._entries if e.document_id != document_id]

    async def get(self) -> str:
        while not self._entries:
            self._not_empty.clear()
            await self._not_empty.wait()
        return _pop(self._entries).document_id

    def positions(self) -> dict[str, int]:
        """1-based serving order if nothing new arrives. Safe to call from a worker thread."""
        simulated = [
            _Entry(e.priority, e.arrival, e.document_id, e.overtaken) for e in list(self._entries)
        ]
        positions = {}
        for position in range(1, len(simulated) + 1):
            positions[_pop(simulated).document_id] = position
        return positions

    def __contains__(self, document_id: object) -> bool:
        return any(e.document_id == document_id for e in list(self._entries))

    def __len__(self) -> int:
        return len(self._entries)
