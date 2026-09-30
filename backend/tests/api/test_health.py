from fastapi.testclient import TestClient
from pydantic import SecretStr

from docchat.core.config import Settings
from tests.fakes import FakeEmbedder, FakeScanner
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


def test_config_reports_retrieval_only_without_key(settings: Settings) -> None:
    with TestClient(make_app(settings)) as c:
        body = c.get("/api/config").json()
    assert body == {
        "version": "dev",
        "commit": "unknown",
        "llm_status": "missing_key",
        "limits": {"max_upload_mb": 1024, "max_pdf_pages": 5000, "max_storage_mb": 20480},
        "features": {"retrieval_only": True, "malware_scan": "off"},
    }


def test_config_with_key_is_unchecked_and_never_leaks_it(settings: Settings) -> None:
    keyed = settings.model_copy(update={"anthropic_api_key": SecretStr("sk-ant-test-123")})
    with TestClient(make_app(keyed)) as c:
        r = c.get("/api/config")
    assert r.json()["llm_status"] == "unchecked"
    assert r.json()["features"]["retrieval_only"] is False
    assert "sk-ant-test-123" not in r.text


def test_config_reports_the_malware_scan_mode(settings: Settings) -> None:
    required = settings.model_copy(update={"malware_scan": "required"})
    with TestClient(make_app(required, scanner=FakeScanner())) as c:
        assert c.get("/api/config").json()["features"]["malware_scan"] == "required"
