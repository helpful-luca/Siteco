import os
import shutil
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
    # No clamd in unit tests: tests that need a scanner pass a fake one to build_container.
    # OCR is off unless a test asks for it: the `ocr` tests need the Tesseract binary.
    return Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        anthropic_api_key=None,
        malware_scan="off",
        ocr="off",
    )


_OPT_IN = {"slow": "RUN_SLOW", "docker": "RUN_DOCKER", "live": "RUN_LIVE"}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    if shutil.which("tesseract") is None:
        # Runs in CI and in the Docker image; locally only with Tesseract installed.
        skip_ocr = pytest.mark.skip(reason="ocr test: needs the tesseract binary")
        for item in items:
            if "ocr" in item.keywords:
                item.add_marker(skip_ocr)
    for marker, variable in _OPT_IN.items():
        if os.environ.get(variable) == "1":
            continue
        skip = pytest.mark.skip(reason=f"{marker} test: set {variable}=1")
        for item in items:
            if marker in item.keywords:
                item.add_marker(skip)
