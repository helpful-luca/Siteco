"""GET /api/eval: the runner's results file plus whether it still fits the configuration."""

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from docchat.core.config import Settings
from docchat.core.retrieval_fingerprint import retrieval_fingerprint
from docchat.domain.eval_config import config_hash
from tests.support import make_app

LATEST = Path(__file__).resolve().parents[3] / "eval" / "results" / "latest.json"


def committed() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(LATEST.read_text(encoding="utf-8"))
    return data


def client_with(settings: Settings, tmp_path: Path, **files: Any) -> TestClient:
    results = tmp_path / "results"
    results.mkdir()
    for name, content in files.items():
        text = content if isinstance(content, str) else json.dumps(content)
        (results / f"{name}.json").write_text(text, encoding="utf-8")
    settings = settings.model_copy(update={"eval_results_dir": results})
    return TestClient(make_app(settings))


def test_results_of_the_current_configuration(settings: Settings, tmp_path: Path) -> None:
    latest = committed() | {"config_hash": config_hash(retrieval_fingerprint(settings))}
    with client_with(settings, tmp_path, latest=latest) as client:
        r = client.get("/api/eval")
    assert r.status_code == 200
    body = r.json()
    assert body["stale"] is False and body["generation"] is None
    assert body["configs"][0]["id"] == "hybrid-german"
    assert body["dataset"]["questions"] == latest["dataset"]["questions"]


def test_results_of_other_settings_are_stale(settings: Settings, tmp_path: Path) -> None:
    latest = committed() | {"config_hash": "0000000000000000"}
    with client_with(settings, tmp_path, latest=latest) as client:
        assert client.get("/api/eval").json()["stale"] is True


def test_generation_results_come_along_when_present(settings: Settings, tmp_path: Path) -> None:
    generation = {
        "created_at": "2026-10-01T10:00:00Z",
        "commit": "abc1234",
        "judge_model": "claude-sonnet-5-5",
        "models": [
            {"model": "claude-haiku-4-5", "questions": 32, "correct": 0.8, "citation_accuracy": 0.9,
             "abstention": 1.0, "cost_usd": 0.05, "latency_p50_ms": 1800, "ttft_p50_ms": 600}
        ],
    }  # fmt: skip
    with client_with(settings, tmp_path, latest=committed(), generation=generation) as client:
        body = client.get("/api/eval").json()
    assert body["generation"]["models"][0]["model"] == "claude-haiku-4-5"


def test_missing_or_broken_results(settings: Settings, tmp_path: Path) -> None:
    cases: list[dict[str, Any]] = [{}, {"latest": "{not json"}, {"latest": {"schema_version": 1}}]
    for i, files in enumerate(cases):
        folder = tmp_path / str(i)
        folder.mkdir()
        with client_with(settings, folder, **files) as client:
            r = client.get("/api/eval")
        assert r.status_code == 404, files
        assert r.json()["error"]["code"] == "EVAL_RESULTS_MISSING"
