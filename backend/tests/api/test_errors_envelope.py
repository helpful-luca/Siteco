import logging
from collections.abc import Iterator

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from docchat.core.config import Settings
from tests.support import make_app


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = make_app(settings)
    probes = APIRouter()

    @probes.get("/api/_test/boom")
    def _boom() -> None:
        raise RuntimeError("secret stack detail")

    @probes.get("/api/_test/needs-int")
    def _needs_int(n: int) -> dict[str, int]:
        return {"n": n}

    app.include_router(probes)
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_unknown_route_returns_not_found_envelope(client: TestClient) -> None:
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    body = r.json()["error"]
    assert body["code"] == "NOT_FOUND"
    assert body["retryable"] is False
    assert body["request_id"].startswith("req_")
    assert r.headers["x-request-id"] == body["request_id"]


def test_wrong_method_returns_envelope(client: TestClient) -> None:
    r = client.delete("/api/health/live")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_validation_error_envelope_has_details(client: TestClient) -> None:
    r = client.get("/api/_test/needs-int", params={"n": "abc"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["details"][0]["loc"] == ["query", "n"]


def test_unhandled_exception_hides_stack_and_logs_request_id(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="docchat.errors"):
        r = client.get("/api/_test/boom")
    assert r.status_code == 500
    body = r.json()["error"]
    assert body["code"] == "INTERNAL_ERROR"
    assert "secret stack detail" not in r.text
    assert any(getattr(rec, "request_id", None) == body["request_id"] for rec in caplog.records)


def test_valid_incoming_request_id_is_echoed(client: TestClient) -> None:
    r = client.get("/api/health/live", headers={"X-Request-ID": "req_abcdef12"})
    assert r.headers["x-request-id"] == "req_abcdef12"


def test_malformed_incoming_request_id_is_replaced(client: TestClient) -> None:
    r = client.get("/api/health/live", headers={"X-Request-ID": "<script>"})
    assert r.headers["x-request-id"].startswith("req_")
    assert r.headers["x-request-id"] != "<script>"
