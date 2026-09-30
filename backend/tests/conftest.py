from collections.abc import Iterator
from pathlib import Path

import pytest

from docchat.core.config import Settings


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in ("ANTHROPIC_API_KEY", "INTERNAL_TOKEN", "LLM_PROVIDER", "DATA_DIR"):
        monkeypatch.delenv(name, raising=False)
    yield


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, data_dir=tmp_path / "data", anthropic_api_key=None)
