"""Chunks between the parse and the embed pass, as JSON lines on disk (constant memory)."""

import json
import shutil
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import TextIO

from docchat.domain.models import Chunk, Sentence


def _encode(chunk: Chunk) -> str:
    return json.dumps(asdict(chunk), ensure_ascii=False, separators=(",", ":"))


def _decode(line: str) -> Chunk:
    data = json.loads(line)
    sentences = tuple(
        Sentence(
            i=s["i"],
            text=s["text"],
            char_start=s["char_start"],
            char_end=s["char_end"],
            rects=tuple((r[0], r[1], r[2], r[3]) for r in s["rects"]),
        )
        for s in data.pop("sentences")
    )
    return Chunk(**data, sentences=sentences)


class _Writer:
    def __init__(self, path: Path) -> None:
        self._file: TextIO = path.open("w", encoding="utf-8")

    def write(self, chunks: Sequence[Chunk]) -> None:
        self._file.writelines(_encode(c) + "\n" for c in chunks)

    def close(self) -> None:
        self._file.close()


class _Reader:
    def __init__(self, path: Path) -> None:
        self._file: TextIO = path.open("r", encoding="utf-8")

    def read(self, max_chunks: int) -> list[Chunk]:
        chunks = []
        for line in self._file:
            chunks.append(_decode(line))
            if len(chunks) >= max_chunks:
                break
        return chunks

    def close(self) -> None:
        self._file.close()


class JsonlChunkSpool:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, document_id: str) -> Path:
        return self.root / f"{document_id}.jsonl"

    def writer(self, document_id: str) -> _Writer:
        self.root.mkdir(parents=True, exist_ok=True)
        return _Writer(self._path(document_id))

    def reader(self, document_id: str) -> _Reader:
        return _Reader(self._path(document_id))

    def discard(self, document_id: str) -> None:
        self._path(document_id).unlink(missing_ok=True)

    def clear(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
