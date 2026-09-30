import os
from pathlib import Path

import pytest

from docchat.adapters.fastembed_embedder import GRANITE_97M, FastEmbedEmbedder

CACHE_DIR = Path(os.environ.get("EMBEDDING_CACHE_DIR", "/opt/models"))

pytestmark = [
    pytest.mark.model,
    pytest.mark.skipif(not CACHE_DIR.exists(), reason="embedding model cache not present"),
]


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def test_granite_loads_offline_and_is_cross_lingual(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    embedder = FastEmbedEmbedder(GRANITE_97M, CACHE_DIR, local_files_only=True)
    embedder.load()
    german, english, unrelated = embedder.embed_documents(
        [
            "Die Strassenleuchte hat 5000 Lumen.",
            "The street light has 5000 lumens.",
            "Ich esse gerne Pizza.",
        ]
    )
    assert embedder.dim == 384
    assert _cosine(german, english) > _cosine(german, unrelated) + 0.2
