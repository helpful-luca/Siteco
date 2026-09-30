"""Capabilities the services depend on. Adapters implement them."""

from collections.abc import Sequence
from typing import Protocol


class Embedder(Protocol):
    dim: int

    def load(self) -> None: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...
