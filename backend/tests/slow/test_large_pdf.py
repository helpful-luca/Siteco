"""A generated 1500-page catalog must ingest in reasonable time with flat memory.

Run with `RUN_SLOW=1 uv run pytest tests/slow -s` to see the measurements. The model variant
also needs the embedding model files (see tests/model).
"""

import os
import time
import tracemalloc
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from docchat.adapters.fastembed_embedder import GRANITE_97M, FastEmbedEmbedder
from docchat.core.config import Settings
from docchat.domain.ports import Embedder
from tests.pdf_factory import PageSpec, TextLine, build_pdf
from tests.support import make_app

pytestmark = pytest.mark.slow

LINES_PER_PAGE = 30
MODEL_DIR = Path(os.environ.get("EMBEDDING_CACHE_DIR", "/opt/models"))


def _catalog(pages: int) -> bytes:
    def line(page: int, n: int) -> str:
        return (
            f"Leuchte {page}-{n}: Schutzart IP66, 5000 lm, Lichtfarbe 4000 K, Gehaeuse aus "
            f"Aluminium. Artikelnummer {page:04d}{n:02d}."
        )

    specs = [
        PageSpec(
            lines=[
                TextLine(line(p, n), x=40, y=770 - n * 24, size=8) for n in range(LINES_PER_PAGE)
            ]
        )
        for p in range(1, pages + 1)
    ]
    return build_pdf(specs)


def _ingest(
    settings: Settings, data: bytes, pages: int, embedder: Embedder | None = None
) -> tuple[float, dict[str, Any]]:
    with TestClient(make_app(settings, embedder=embedder)) as client:
        started = time.perf_counter()
        r = client.post(
            "/api/documents",
            content=data,
            headers={
                "X-File-Name": quote(f"Katalog {pages}.pdf"),
                "Content-Type": "application/octet-stream",
            },
        )
        assert r.status_code == 202, r.text
        doc_id = r.json()["document"]["id"]
        while True:
            doc = client.get(f"/api/documents/{doc_id}").json()["document"]
            if doc["status"] in {"ready", "failed"}:
                break
            time.sleep(0.2)
        duration = time.perf_counter() - started
    assert doc["status"] == "ready", doc
    assert doc["page_count"] == pages
    return duration, doc


@pytest.fixture
def fresh_settings(tmp_path: Path) -> Iterator[Settings]:
    yield Settings(_env_file=None, data_dir=tmp_path / "data")  # type: ignore[call-arg]


def test_1500_pages_ingest_fast_with_flat_memory(tmp_path: Path) -> None:
    def settings(name: str) -> Settings:
        return Settings(_env_file=None, data_dir=tmp_path / name)  # type: ignore[call-arg]

    small, large = _catalog(150), _catalog(1500)
    duration, doc = _ingest(settings("timing"), large, 1500)
    print(
        f"\n1500 pages ({len(large) / 2**20:.1f} MB), fake embedder: {duration:.1f} s,"
        f" {doc['chunk_count']} chunks"
    )
    assert duration < 180

    tracemalloc.start()
    try:
        _ingest(settings("small"), small, 150)
        small_peak = tracemalloc.get_traced_memory()[1]
        tracemalloc.reset_peak()
        _ingest(settings("large"), large, 1500)
        large_peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    print(
        f"peak Python memory: 150 pages {small_peak / 2**20:.1f} MB, "
        f"1500 pages {large_peak / 2**20:.1f} MB"
    )
    # Ten times the pages must not mean ten times the memory: the pipeline streams in batches.
    assert large_peak < small_peak * 2


@pytest.mark.model
@pytest.mark.skipif(not MODEL_DIR.exists(), reason="embedding model cache not present")
def test_1500_pages_with_the_real_embedding_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    embedder = FastEmbedEmbedder(
        GRANITE_97M, MODEL_DIR, local_files_only=True, threads=max(1, (os.cpu_count() or 2) // 2)
    )
    settings = Settings(_env_file=None, data_dir=tmp_path / "data")  # type: ignore[call-arg]
    duration, doc = _ingest(settings, _catalog(1500), 1500, embedder)
    print(f"\n1500 pages, Granite 97M: {duration:.1f} s, {doc['chunk_count']} chunks")
    assert duration < 15 * 60
