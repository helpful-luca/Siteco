"""LanceDB table `chunks`: vectors, BM25 full text index and highlight data.

One connection and one table handle per process. Writes (add, delete, optimize) are serialized
by a lock, because concurrent deletes and optimize can cause commit conflicts.
Filters are built only from validated UUIDs, so they cannot be injected.
"""

import json
import re
import threading
from collections.abc import Collection, Sequence
from dataclasses import asdict
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import lancedb
import pyarrow as pa
from lancedb.index import FTS
from lancedb.rerankers import RRFReranker

from docchat.domain.highlight_geometry import trusted_rects
from docchat.domain.models import Chunk, Sentence

TABLE = "chunks"
# Old table versions are removed after this delay; queries in flight may still read them.
# Only for normal ingestion: after a deletion `purge_deleted` removes them at once.
_KEEP_OLD_VERSIONS = timedelta(minutes=5)
_READ_COLUMNS = [
    "chunk_id", "document_id", "ordinal", "page", "heading", "text", "search_text",
    "sentences", "precise_highlight",
]  # fmt: skip


def _schema(dim: int) -> pa.Schema:
    return pa.schema(
        [
            pa.field("chunk_id", pa.string(), nullable=False),
            pa.field("document_id", pa.string(), nullable=False),
            pa.field("ordinal", pa.int32(), nullable=False),
            pa.field("page", pa.int32()),
            pa.field("heading", pa.string()),
            pa.field("text", pa.string()),
            pa.field("search_text", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
            pa.field("sentences", pa.string()),
            pa.field("precise_highlight", pa.bool_()),
        ]
    )


def _fts_config(language: str) -> FTS:
    """BM25 index of `search_text`."""
    return FTS(
        language=language, stem=True, remove_stop_words=True, ascii_folding=True, lower_case=True
    )


def _uuid(value: str) -> str:
    """Raises ValueError unless value is a canonical UUID string."""
    if str(UUID(value)) != value:
        raise ValueError("not a canonical uuid")
    return value


def _in_filter(document_ids: Collection[str]) -> str:
    return "document_id IN ({})".format(", ".join(f"'{_uuid(d)}'" for d in document_ids))


_PLAIN_TERM = re.compile(r"[0-9A-Za-z\u00c0-\u00ff.\-/, ]{1,80}")


def _like_term(term: str) -> str:
    """A lower case term or phrase that is safe inside a LIKE pattern: no quote, `%` or `_`."""
    if _PLAIN_TERM.fullmatch(term) is None:
        raise ValueError("not a plain search term")
    return term.lower()


def _sentences_json(sentences: Sequence[Sentence]) -> str:
    return json.dumps([asdict(s) for s in sentences], ensure_ascii=False, separators=(",", ":"))


def _row_to_chunk(row: dict[str, Any]) -> Chunk:
    sentences = tuple(
        Sentence(
            i=s["i"],
            text=s["text"],
            char_start=s["char_start"],
            char_end=s["char_end"],
            rects=trusted_rects([(r[0], r[1], r[2], r[3]) for r in s["rects"]]),
        )
        for s in json.loads(row["sentences"])
    )
    return Chunk(
        chunk_id=row["chunk_id"],
        document_id=row["document_id"],
        ordinal=row["ordinal"],
        page=row["page"],
        heading=row["heading"],
        text=row["text"],
        search_text=row["search_text"],
        sentences=sentences,
        precise_highlight=row["precise_highlight"],
    )


class LanceVectorStore:
    def __init__(self, path: Path, *, fts_language: str) -> None:
        self.path = path
        self.fts_language = fts_language
        self._write_lock = threading.Lock()
        self._table: Any = None
        self._dim = 0

    def open(self, dim: int) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        db = lancedb.connect(self.path)
        if TABLE in db.list_tables().tables:
            table = db.open_table(TABLE)
            existing = table.schema.field("vector").type.list_size
            if existing != dim:
                raise RuntimeError(f"index has {existing} dimensions, embedder has {dim}")
        else:
            table = db.create_table(TABLE, schema=_schema(dim))
        if not any(i.index_type == "FTS" for i in table.list_indices()):
            table.create_index("search_text", config=_fts_config(self.fts_language))
        self._table, self._dim = table, dim

    def _require(self) -> Any:
        if self._table is None:
            raise RuntimeError("vector store not open")
        return self._table

    def ping(self) -> bool:
        try:
            self._require().count_rows()
        except Exception:
            return False
        return True

    def add(self, chunks: Sequence[Chunk], vectors: Sequence[Sequence[float]]) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("one vector per chunk")
        if not chunks:
            return
        batch = pa.Table.from_pydict(
            {
                "chunk_id": [_uuid(c.chunk_id) for c in chunks],
                "document_id": [_uuid(c.document_id) for c in chunks],
                "ordinal": [c.ordinal for c in chunks],
                "page": [c.page for c in chunks],
                "heading": [c.heading for c in chunks],
                "text": [c.text for c in chunks],
                "search_text": [c.search_text for c in chunks],
                "vector": [list(v) for v in vectors],
                "sentences": [_sentences_json(c.sentences) for c in chunks],
                "precise_highlight": [c.precise_highlight for c in chunks],
            },
            schema=_schema(self._dim),
        )
        with self._write_lock:
            self._require().add(batch)

    def delete_document(self, document_id: str) -> None:
        with self._write_lock:
            self._require().delete(f"document_id = '{_uuid(document_id)}'")

    def document_ids(self) -> set[str]:
        column = self._require().search().select(["document_id"]).limit(None).to_arrow()
        return set(column["document_id"].to_pylist())

    def delete_documents_except(self, keep: Collection[str]) -> None:
        for document_id in self.document_ids() - set(keep):
            self.delete_document(document_id)

    def optimize(self) -> None:
        with self._write_lock:
            self._require().optimize(cleanup_older_than=_KEEP_OLD_VERSIONS)

    def purge_deleted(self) -> None:
        """Deleted rows are only marked until compaction rewrites their fragments, and old
        versions keep the files. After a deletion (GDPR): compact, then
        remove every old version and leftover file now. Safe under the write lock, because this
        process is the only writer; a search in flight on an old version may fail once."""
        with self._write_lock:
            self._require().optimize(cleanup_older_than=timedelta(0), delete_unverified=True)

    def get_chunk(self, document_id: str, chunk_id: str) -> Chunk | None:
        rows = (
            self._require()
            .search()
            .where(f"document_id = '{_uuid(document_id)}' AND chunk_id = '{_uuid(chunk_id)}'")
            .select(_READ_COLUMNS)
            .limit(1)
            .to_list()
        )
        return _row_to_chunk(rows[0]) if rows else None

    def count(self, document_id: str) -> int:
        return int(self._require().count_rows(f"document_id = '{_uuid(document_id)}'"))

    def search(
        self,
        text: str,
        vector: Sequence[float],
        document_ids: Collection[str],
        limit: int,
    ) -> list[Chunk]:
        """Vector and BM25 (German stemming) fused by reciprocal rank. The filter runs before
        ranking (`prefilter=True`), otherwise top-k could come back short or empty."""
        if not document_ids:
            return []
        rows = (
            self._require()
            .search(query_type="hybrid")
            .vector(list(vector))
            .text(text)
            .where(_in_filter(document_ids), prefilter=True)
            .rerank(RRFReranker())
            .limit(limit)
            .select(_READ_COLUMNS)
            .to_list()
        )
        return [_row_to_chunk(r) for r in rows]

    def chunks_of_pages(self, document_ids: Collection[str], pages: Collection[int]) -> list[Chunk]:
        if not document_ids or not pages:
            return []
        numbers = ", ".join(str(int(p)) for p in pages)
        rows = (
            self._require()
            .search()
            .where(f"{_in_filter(document_ids)} AND page IN ({numbers})")
            .select(_READ_COLUMNS)
            .limit(None)
            .to_list()
        )
        order = {d: i for i, d in enumerate(document_ids)}
        chunks = [_row_to_chunk(r) for r in rows]
        return sorted(chunks, key=lambda c: (order[c.document_id], c.page or 0, c.ordinal))

    def find_text(self, term: str, document_ids: Collection[str], limit: int) -> list[Chunk]:
        pattern = _like_term(term)
        if not document_ids:
            return []
        rows = (
            self._require()
            .search()
            .where(f"{_in_filter(document_ids)} AND lower(text) LIKE '%{pattern}%'")
            .select(_READ_COLUMNS)
            .limit(limit)
            .to_list()
        )
        return [_row_to_chunk(r) for r in rows]

    def chunks_of(self, document_ids: Collection[str]) -> list[Chunk]:
        if not document_ids:
            return []
        rows = (
            self._require()
            .search()
            .where(_in_filter(document_ids))
            .select(_READ_COLUMNS)
            .limit(None)
            .to_list()
        )
        order = {d: i for i, d in enumerate(document_ids)}
        chunks = [_row_to_chunk(r) for r in rows]
        return sorted(chunks, key=lambda c: (order[c.document_id], c.ordinal))
