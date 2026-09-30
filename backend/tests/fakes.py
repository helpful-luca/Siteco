"""Test doubles for ports. Deterministic and dependency-free."""

import time
from collections.abc import Sequence


class FakeEmbedder:
    """Vector depends only on text length, so tests are deterministic."""

    def __init__(self, dim: int = 384, *, fail: bool = False, delay_s: float = 0.0) -> None:
        self.dim = dim
        self.fail = fail
        self.delay_s = delay_s

    def load(self) -> None:
        time.sleep(self.delay_s)
        if self.fail:
            raise RuntimeError("model files missing")

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self.embed_query(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return [float(len(text) % 7)] * self.dim
