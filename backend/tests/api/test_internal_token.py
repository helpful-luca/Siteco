from fastapi.testclient import TestClient
from pydantic import SecretStr

from docchat.core.config import Settings
from tests.support import make_app


def _client(settings: Settings, token: str | None) -> TestClient:
    secret = SecretStr(token) if token else None
    return TestClient(make_app(settings.model_copy(update={"internal_token": secret})))


def test_token_not_configured_allows_requests(settings: Settings) -> None:
    with _client(settings, None) as c:
        assert c.get("/api/config").status_code == 200


def test_token_configured_rejects_missing_header(settings: Settings) -> None:
    with _client(settings, "s3cret") as c:
        r = c.get("/api/config")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED_CLIENT"


def test_token_configured_rejects_wrong_header(settings: Settings) -> None:
    with _client(settings, "s3cret") as c:
        assert c.get("/api/config", headers={"X-Internal-Token": "nope"}).status_code == 401


def test_token_configured_accepts_matching_header(settings: Settings) -> None:
    with _client(settings, "s3cret") as c:
        assert c.get("/api/config", headers={"X-Internal-Token": "s3cret"}).status_code == 200


def test_health_never_needs_token(settings: Settings) -> None:
    with _client(settings, "s3cret") as c:
        assert c.get("/api/health/live").status_code == 200
        assert c.get("/api/health/ready").status_code == 200
