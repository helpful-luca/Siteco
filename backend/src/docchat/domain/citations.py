"""Builds the answer text and places citation markers.

Claude may send a citation before its block's text has finished streaming, so citations are
buffered per block and placed when the block stops. That keeps `char_offset` deterministic.
"""

from collections.abc import Collection

from docchat.domain.chat_models import Citation
from docchat.domain.llm import CitationDelta


class AnswerAssembler:
    def __init__(self, known_sources: Collection[str]) -> None:
        self._known = frozenset(known_sources)
        self._parts: list[str] = []
        self._length = 0
        self._pending: list[CitationDelta] = []
        self._citations: list[Citation] = []
        self._placed: set[tuple[str, int, int, int]] = set()
        self.discarded = 0  # citations of unknown sources or with broken ranges

    @property
    def text(self) -> str:
        return "".join(self._parts)

    @property
    def citations(self) -> tuple[Citation, ...]:
        return tuple(self._citations)

    @property
    def has_text(self) -> bool:
        return self._length > 0

    def add_text(self, text: str) -> None:
        self._parts.append(text)
        self._length += len(text)

    def add_citation(self, citation: CitationDelta) -> None:
        self._pending.append(citation)

    def end_block(self) -> list[Citation]:
        """Places the block's citations at the current text length and returns the new ones."""
        placed: list[Citation] = []
        for delta in self._pending:
            if delta.source not in self._known or not 0 <= delta.block_start < delta.block_end:
                self.discarded += 1
                continue
            key = (delta.source, delta.block_start, delta.block_end, self._length)
            if key in self._placed:
                continue  # the same source and range twice at one spot: one chip
            self._placed.add(key)
            citation = Citation(
                source_id=delta.source,
                block_start=delta.block_start,
                block_end=delta.block_end,
                cited_text=delta.cited_text,
                char_offset=self._length,
            )
            self._citations.append(citation)
            placed.append(citation)
        self._pending.clear()
        return placed
