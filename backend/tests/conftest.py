import os
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


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    if os.environ.get("RUN_SLOW") == "1":
        return
    skip = pytest.mark.skip(reason="slow test: set RUN_SLOW=1")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)
