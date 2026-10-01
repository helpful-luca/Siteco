import logging

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import SecretStr

from docchat.api.middleware import RequestContextMiddleware
from docchat.core.config import Settings
from tests.fakes import FakeEmbedder
from tests.support import make_app


def test_live_is_always_ok(settings: Settings) -> None:
    with TestClient(make_app(settings)) as c:
        assert c.get("/api/health/live").json() == {"app": "siteco-docchat", "status": "ok"}


def test_ready_ok_after_model_loaded(settings: Settings) -> None:
    with TestClient(make_app(settings)) as c:
        r = c.get("/api/health/ready")
    assert r.status_code == 200
    assert r.json() == {
        "ready": True,
        "checks": {
            "db": "ok",
            "vector_store": "ok",
            "embedding_model": "ok",
            "llm": "missing_key",
        },
    }


def test_ready_503_when_model_failed(settings: Settings) -> None:
    with TestClient(make_app(settings, embedder=FakeEmbedder(fail=True))) as c:
        r = c.get("/api/health/ready")
    assert r.status_code == 503
    assert r.json()["ready"] is False
    assert r.json()["checks"]["embedding_model"] == "failed"
    assert r.json()["checks"]["vector_store"] == "failed"


def test_only_failed_health_checks_reach_the_info_log(caplog: pytest.LogCaptureFixture) -> None:
    app = FastAPI()
    app.get("/api/health/live")(lambda: {})
    app.get("/api/health/ready")(lambda: JSONResponse({}, status_code=503))
    app.get("/api/config")(lambda: {})
    app.add_middleware(RequestContextMiddleware)
    with TestClient(app) as c, caplog.at_level(logging.INFO, logger="docchat.access"):
        c.get("/api/health/live")
        c.get("/api/health/ready")
        c.get("/api/config")
    access = [r for r in caplog.records if r.name == "docchat.access"]
    routes = [getattr(r, "route", None) for r in access if r.levelno >= logging.INFO]
    assert routes == ["/api/health/ready", "/api/config"]


def test_config_reports_retrieval_only_without_key(settings: Settings) -> None:
    with TestClient(make_app(settings)) as c:
        body = c.get("/api/config").json()
    assert body | {"models": None} == {
        "version": "dev",
        "commit": "unknown",
        "llm_status": "missing_key",
        "limits": {
            "max_upload_mb": 1024,
            "max_pdf_pages": 5000,
            "max_storage_mb": 20480,
            "max_question_chars": 4000,
            "chat_per_minute": 20,
            "uploads_per_minute": 30,
            "max_concurrent_answers": 3,
            "daily_budget_usd": None,
        },
        "budget": None,
        "features": {"retrieval_only": True},
        "models": None,
        "default_model": "claude-sonnet-5-5",
    }


def test_config_with_key_is_unchecked_and_never_leaks_it(settings: Settings) -> None:
    keyed = settings.model_copy(update={"anthropic_api_key": SecretStr("sk-ant-test-123")})
    with TestClient(make_app(keyed)) as c:
        r = c.get("/api/config")
    assert r.json()["llm_status"] == "unchecked"
    assert r.json()["features"]["retrieval_only"] is False
    assert "sk-ant-test-123" not in r.text
