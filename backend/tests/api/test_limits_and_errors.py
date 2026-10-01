"""Own limits and every Claude error path over HTTP (annex 10, P0 of I, H, P5; WP-F)."""

from collections.abc import Iterator
from typing import Any

import pytest

from docchat.adapters.fake_llm import FakeLLMClient, FakeScenario
from docchat.core.config import Settings
from tests.api.test_chats import (
    add_document,
    app_client,
    ask,
    ask_body,
    error,
    messages,
    new_chat,
    terminal,
)
from tests.api.test_documents import upload


def limited(settings: Settings, **changes: Any) -> Settings:
    return settings.model_copy(update=changes)


def test_own_chat_limit_is_429_with_a_countdown(settings: Settings) -> None:
    with app_client(limited(settings, rate_chat_per_min=1), FakeLLMClient()) as client:
        add_document(client)
        chat_id = new_chat(client)
        first, _ = ask(client, chat_id)
        assert first.status_code == 200
        r = client.post(f"/api/chats/{chat_id}/messages", json=ask_body(content="Und dann?"))
        body = error(r)
        assert (r.status_code, body["code"], body["retryable"]) == (429, "RATE_LIMITED", True)
        assert r.headers["content-type"].startswith("application/json")
        seconds = body["params"]["seconds"]
        assert 55 <= seconds <= 60 and body["params"]["scope"] == "chat"
        assert body["retry_after"] == seconds and r.headers["retry-after"] == str(seconds)
        assert len(messages(client, chat_id)) == 2  # the refused question is not saved
        # Polling and lists are never limited (annex 10, I10).
        for path in ("/api/health/live", "/api/config", "/api/chats", "/api/documents"):
            assert client.get(path).status_code == 200


def test_own_upload_limit_is_429_with_a_countdown(settings: Settings) -> None:
    with app_client(limited(settings, rate_upload_per_min=1)) as client:
        assert upload(client, "a.md", b"# A\n\nErste Datei mit Text.\n").status_code == 202
        r = upload(client, "b.md", b"# B\n\nZweite Datei mit Text.\n")
        body = error(r)
        assert (r.status_code, body["code"], body["params"]["scope"]) == (
            429,
            "RATE_LIMITED",
            "upload",
        )
        assert r.headers["retry-after"] == str(body["retry_after"])
        # A file refused for its type does not count against the limit.
        assert error(upload(client, "c.docx", b"PK"))["code"] == "UNSUPPORTED_TYPE"


def test_json_bodies_are_limited(settings: Settings) -> None:
    with app_client(settings) as client:
        big = {"scope": "all", "padding": "x" * 70_000}
        r = client.post("/api/chats", json=big)
        assert (r.status_code, error(r)["code"]) == (413, "REQUEST_TOO_LARGE")

        def chunks() -> Iterator[bytes]:  # no Content-Length: counted while reading
            yield b'{"scope": "all", "padding": "'
            for _ in range(70):
                yield b"x" * 1024
            yield b'"}'

        r = client.post(
            "/api/chats", content=chunks(), headers={"content-type": "application/json"}
        )
        assert (r.status_code, error(r)["code"]) == (413, "REQUEST_TOO_LARGE")


@pytest.mark.parametrize(
    ("scenario", "code", "retryable", "retry_after"),
    [
        (FakeScenario.AUTH, "LLM_AUTH", False, None),
        (FakeScenario.BILLING, "LLM_BILLING", False, None),
        (FakeScenario.FORBIDDEN, "LLM_FORBIDDEN", False, None),
        (FakeScenario.MODEL_NOT_FOUND, "MODEL_UNAVAILABLE", False, None),
        (FakeScenario.RATE_LIMITED, "LLM_RATE_LIMITED", True, 30),
        (FakeScenario.OVERLOADED, "LLM_OVERLOADED", True, 1),
        (FakeScenario.UNAVAILABLE, "LLM_UNAVAILABLE", True, None),
        (FakeScenario.UNREACHABLE, "LLM_UNREACHABLE", True, None),
        (FakeScenario.BAD_REQUEST, "LLM_BAD_REQUEST", False, None),
        (FakeScenario.CONTEXT_TOO_LARGE, "LLM_CONTEXT_TOO_LARGE", False, None),
        (FakeScenario.EMPTY, "LLM_EMPTY_ANSWER", True, None),
        (FakeScenario.HANG, "LLM_TIMEOUT", True, None),
    ],
)
def test_every_claude_error_ends_the_stream_with_one_error_event(
    settings: Settings, scenario: FakeScenario, code: str, retryable: bool, retry_after: int | None
) -> None:
    fast = limited(settings, llm_max_retries=0, llm_ttft_timeout_s=0.2)
    with app_client(fast, FakeLLMClient([scenario, scenario])) as client:
        add_document(client)
        chat_id = new_chat(client)
        r, events = ask(client, chat_id)
        assert r.status_code == 200  # the stream was open: errors are events now (S1)
        end = terminal(events)
        assert end.name == "error" and end.data["partial"] is False
        body = end.data["error"]
        assert (body["code"], body["retryable"], body["retry_after"]) == (
            code,
            retryable,
            retry_after,
        )
        assert body["request_id"] == r.headers["x-request-id"]
        if retry_after is not None:
            assert body["params"]["seconds"] == retry_after
        saved = messages(client, chat_id)[1]
        assert (saved["status"], saved["error_code"]) == ("error", code)
        # The error id stays with the saved answer, so it can still be copied after a reload.
        assert saved["error_request_id"] == r.headers["x-request-id"]


def test_a_rejected_key_switches_the_app_to_sources_only(settings: Settings) -> None:
    with app_client(settings, FakeLLMClient([FakeScenario.AUTH])) as client:
        assert client.get("/api/config").json()["llm_status"] == "ok"
        add_document(client)
        chat_id = new_chat(client)
        _, events = ask(client, chat_id)
        assert terminal(events).data["error"]["code"] == "LLM_AUTH"
        config = client.get("/api/config").json()
        assert (config["llm_status"], config["features"]["retrieval_only"]) == (
            "invalid_key",
            True,
        )
        _, after = ask(client, chat_id, content="Und die Leistung?")
        assert terminal(after).data["status"] == "sources_only"


def test_a_model_claude_does_not_know_is_refused_before_the_stream(settings: Settings) -> None:
    with app_client(settings, FakeLLMClient([FakeScenario.MODEL_NOT_FOUND])) as client:
        add_document(client)
        chat_id = new_chat(client)
        _, events = ask(client, chat_id)
        assert terminal(events).data["error"]["params"] == {
            "model": "claude-sonnet-5-5",
            "fallback": "claude-haiku-4-5",
        }
        models = {m["id"]: m["available"] for m in client.get("/api/config").json()["models"]}
        assert models == {
            "claude-haiku-4-5": True,
            "claude-sonnet-5-5": False,
            "claude-opus-5-5": True,
        }
        r = client.post(f"/api/chats/{chat_id}/messages", json=ask_body(content="Noch mal?"))
        assert (r.status_code, error(r)["code"]) == (503, "MODEL_UNAVAILABLE")
        assert error(r)["params"]["fallback"] == "claude-haiku-4-5"
        ok, events = ask(client, chat_id, content="Noch mal?", model="claude-haiku-4-5")
        assert ok.status_code == 200 and terminal(events).data["status"] == "complete"


def test_config_exposes_the_limits(settings: Settings) -> None:
    with app_client(settings) as client:
        config = client.get("/api/config").json()
    assert config["limits"] | {"max_upload_mb": None, "max_storage_mb": None} == {
        "max_upload_mb": None,
        "max_pdf_pages": 5000,
        "max_storage_mb": None,
        "max_question_chars": 4000,
        "chat_per_minute": 20,
        "uploads_per_minute": 30,
        "max_concurrent_answers": 3,
        "daily_budget_usd": None,
    }
    assert config["budget"] is None


def test_config_reports_the_budget_when_one_is_set(settings: Settings) -> None:
    with app_client(limited(settings, daily_budget_usd=0.0), FakeLLMClient()) as client:
        budget = client.get("/api/config").json()["budget"]
    assert budget["limit_usd"] == 0.0 and budget["exceeded"] is True
    assert budget["reset_time"].endswith("T00:00:00Z")


async def test_a_content_length_that_is_no_number_is_refused() -> None:
    """HTTP clients never send one, so the middleware is called directly."""
    import json

    from docchat.api.middleware import BodyLimitMiddleware

    reached: list[bool] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        reached.append(True)

    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"{}", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    middleware = BodyLimitMiddleware(app, max_bytes=1024, exempt=())
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/chats",
        "headers": [(b"content-length", b"12abc")],
    }
    await middleware(scope, receive, send)
    assert reached == []
    assert sent[0]["status"] == 422
    body = json.loads(sent[1]["body"])["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["details"][0]["loc"] == ["header", "content-length"]
