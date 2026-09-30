"""onnxruntime must never send telemetry to Microsoft (GDPR: no third parties, local only)."""

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from docchat.adapters import fastembed_embedder
from docchat.adapters.fastembed_embedder import FastEmbedEmbedder


def test_every_process_disables_telemetry_before_onnxruntime_starts() -> None:
    env = {k: v for k, v in os.environ.items() if k != "ORT_DISABLE_TELEMETRY"}
    script = (
        "import os, sys\n"
        "import docchat.adapters.fastembed_embedder\n"
        "assert 'onnxruntime' in sys.modules\n"
        "print(os.environ.get('ORT_DISABLE_TELEMETRY'))\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True
    )
    assert out.stdout.strip() == "1"


def test_load_disables_telemetry_events_before_creating_a_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    class FakeModel:
        model = None

        def __init__(self, *_: Any, **__: Any) -> None:
            calls.append("session")

        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.0, 1.0] for _ in texts]

    monkeypatch.setattr(
        fastembed_embedder.onnxruntime, "disable_telemetry_events", lambda: calls.append("off")
    )
    monkeypatch.setattr(fastembed_embedder, "TextEmbedding", FakeModel)
    monkeypatch.setattr(fastembed_embedder, "register_custom_models", lambda: None)
    FastEmbedEmbedder("x", cache_dir=Path("."), local_files_only=True).load()
    assert calls[:2] == ["off", "session"]
