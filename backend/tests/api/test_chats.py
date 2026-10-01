"""Chats and answer streams end to end: real SQLite, LanceDB, ingestion; fake embedder and model."""

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from uuid import uuid4

import httpx2
import pytest
from fastapi.testclient import TestClient
from httpx import Response

from docchat.adapters.fake_llm import FakeLLMClient, FakeScenario
from docchat.core.config import Settings
from tests.api.test_documents import upload, wait_until_settled
from tests.live_server import live_server
from tests.sse import Event, parse_events
from tests.support import make_app

DATASHEET = (
    "# Mira\n\nDie Leuchte Mira hat die Schutzart IP66. Sie ist schlagfest nach IK08.\n\n"
    "## Leistung\n\nDie Mira leistet 40 W bei 5000 Lumen.\n"
)
QUESTION = "Welche Schutzart hat die Mira?"


@contextmanager
def app_client(settings: Settings, llm: FakeLLMClient | None = None) -> Iterator[TestClient]:
    with TestClient(make_app(settings, llm=llm)) as client:
        yield client


@pytest.fixture
def llm() -> FakeLLMClient:
    return FakeLLMClient()


@pytest.fixture
def client(settings: Settings, llm: FakeLLMClient) -> Iterator[TestClient]:
    with app_client(settings, llm) as c:
        yield c


def add_document(client: httpx2.Client, text: str = DATASHEET, name: str = "mira.md") -> str:
    document = upload(client, name, text.encode()).json()["document"]
    assert wait_until_settled(client, document["id"])["status"] == "ready"
    return str(document["id"])


def new_chat(client: httpx2.Client, **body: Any) -> str:
    r = client.post("/api/chats", json=body)
    assert r.status_code == 201, r.text
    return str(r.json()["chat"]["id"])


def ask_body(content: str = QUESTION, **changes: Any) -> dict[str, Any]:
    body = {
        "client_message_id": str(uuid4()),
        "content": content,
        "model": "claude-sonnet-5-5",
        "locale": "de",
    }
    return body | changes


def ask(client: TestClient, chat_id: str, **changes: Any) -> tuple[Response, list[Event]]:
    with client.stream("POST", f"/api/chats/{chat_id}/messages", json=ask_body(**changes)) as r:
        if r.status_code != 200:
            r.read()
            return r, []
        return r, list(parse_events(r.iter_lines()))


def error(r: Response) -> dict[str, Any]:
    body: dict[str, Any] = r.json()["error"]
    return body


def terminal(events: list[Event]) -> Event:
    ends = [e for e in events if e.name in {"done", "error"}]
    assert len(ends) == 1 and events[-1] is ends[0], [e.name for e in events]
    return ends[0]


def messages(client: httpx2.Client, chat_id: str) -> list[dict[str, Any]]:
    r = client.get(f"/api/chats/{chat_id}/messages")
    assert r.status_code == 200
    result: list[dict[str, Any]] = r.json()["messages"]
    return result


# Chats


def test_chat_crud(client: TestClient) -> None:
    doc_id = add_document(client)
    everything = new_chat(client)
    focused = new_chat(client, scope="selected", document_ids=[doc_id])

    listed = client.get("/api/chats").json()["chats"]
    assert [c["id"] for c in listed] == [focused, everything]
    assert listed[0] | {"created_at": None, "updated_at": None} == {
        "id": focused,
        "title": None,
        "title_source": "auto",
        "scope": "selected",
        "document_ids": [doc_id],
        "message_count": 0,
        "created_at": None,
        "updated_at": None,
    }

    renamed = client.patch(f"/api/chats/{everything}", json={"title": "Mira"}).json()["chat"]
    assert (renamed["title"], renamed["title_source"]) == ("Mira", "user")
    widened = client.patch(f"/api/chats/{focused}", json={"scope": "all"}).json()["chat"]
    assert (widened["scope"], widened["document_ids"]) == ("all", [])
    assert client.get(f"/api/chats/{focused}").json()["chat"]["scope"] == "all"

    assert client.delete(f"/api/chats/{everything}").status_code == 204
    gone = client.get(f"/api/chats/{everything}")
    assert (gone.status_code, error(gone)["code"]) == (404, "CHAT_NOT_FOUND")


@pytest.mark.parametrize(
    ("method", "path", "body", "status", "code"),
    [
        ("get", "/api/chats/not-a-uuid", None, 422, "VALIDATION_ERROR"),
        ("patch", f"/api/chats/{uuid4()}", {"title": "x"}, 404, "CHAT_NOT_FOUND"),
        ("delete", f"/api/chats/{uuid4()}", None, 404, "CHAT_NOT_FOUND"),
        ("get", f"/api/chats/{uuid4()}/messages", None, 404, "CHAT_NOT_FOUND"),
        ("post", f"/api/chats/{uuid4()}/stop", {}, 404, "CHAT_NOT_FOUND"),
        ("post", "/api/chats", {"scope": "selected", "document_ids": []}, 422, "VALIDATION_ERROR"),
        ("post", "/api/chats", {"scope": "selected", "document_ids": [str(uuid4())]}, 404,
         "NOT_FOUND"),
        ("post", "/api/chats", {"scope": "all", "extra": 1}, 422, "VALIDATION_ERROR"),
    ],
)  # fmt: skip
def test_chat_errors(
    client: TestClient, method: str, path: str, body: Any, status: int, code: str
) -> None:
    r = client.request(method.upper(), path, json=body)
    assert (r.status_code, error(r)["code"]) == (status, code)


# Answer stream


def test_answer_stream_follows_the_protocol(client: TestClient) -> None:
    doc_id = add_document(client)
    chat_id = new_chat(client)
    r, events = ask(client, chat_id)

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"].startswith("no-cache")
    assert r.headers["x-request-id"]
    names = [e.name for e in events]
    assert names[:4] == ["meta", "status", "sources", "status"]
    assert set(names[4:-1]) == {"delta", "citation"}

    meta = events[0].data
    assert meta["chat_id"] == chat_id and meta["lane"] == "a"
    assert meta["model"] == "claude-sonnet-5-5" and meta["request_id"] == r.headers["x-request-id"]
    assert [e.data for e in events if e.name == "status"] == [
        {"phase": "retrieving", "attempt": 1},
        {"phase": "generating", "attempt": 1},
    ]
    sources = events[2].data
    assert sources["mode"] == "full_context" and sources["notices"] == []
    assert {s["document_id"] for s in sources["sources"]} == {doc_id}
    assert all(s["deleted"] is False for s in sources["sources"])

    text = "".join(e.data["text"] for e in events if e.name == "delta")
    [citation] = [e.data for e in events if e.name == "citation"]
    assert citation["source_id"] == sources["sources"][0]["id"]
    assert text[: citation["char_offset"]].endswith(citation["cited_text"])

    done = terminal(events).data
    assert done["status"] == "complete" and done["stop_reason"] == "end_turn"
    assert done["usage"]["output_tokens"] > 0 and done["cost_usd"] > 0
    assert done["latency_ms"]["ttft"] is not None and done["latency_ms"]["total"] >= 0
    assert done["chat"]["title"] == QUESTION

    user, answer = messages(client, chat_id)
    assert (user["role"], user["content"], user["status"]) == ("user", QUESTION, "complete")
    assert answer["status"] == "complete" and answer["content"] == text
    assert answer["parent_id"] == user["id"] and answer["id"] == meta["assistant_message_id"]
    assert answer["citations"] == [citation]
    assert answer["sources"] == sources["sources"]
    assert answer["sources_mode"] == "full_context"
    assert (answer["model"], answer["effort"], answer["lane"]) == ("claude-sonnet-5-5", "low", "a")
    assert answer["usage"] == done["usage"] and answer["cost_usd"] == done["cost_usd"]


def test_sources_of_deleted_documents_are_marked(client: TestClient) -> None:
    doc_id = add_document(client)
    chat_id = new_chat(client)
    ask(client, chat_id)
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    answer = messages(client, chat_id)[1]
    assert answer["sources"] and all(s["deleted"] for s in answer["sources"])


def test_follow_up_gets_history(client: TestClient, llm: FakeLLMClient) -> None:
    add_document(client)
    chat_id = new_chat(client)
    ask(client, chat_id)
    ask(client, chat_id, content="Und die Leistung?")
    assert [t.question for t in llm.requests[1].history] == [QUESTION]


def test_duplicate_click_is_ignored(client: TestClient) -> None:
    add_document(client)
    chat_id = new_chat(client)
    body = ask_body()
    with client.stream("POST", f"/api/chats/{chat_id}/messages", json=body) as first:
        first.read()
    second = client.post(f"/api/chats/{chat_id}/messages", json=body)
    assert (second.status_code, error(second)["code"]) == (409, "DUPLICATE_REQUEST")
    assert second.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize(
    ("changes", "status", "code"),
    [
        ({"content": "   "}, 422, "QUESTION_EMPTY"),
        ({"content": "x" * 4001}, 422, "QUESTION_TOO_LONG"),
        ({"model": "gpt-5"}, 422, "MODEL_NOT_ALLOWED"),
        ({"locale": "fr"}, 422, "VALIDATION_ERROR"),
        ({"client_message_id": "nope"}, 422, "VALIDATION_ERROR"),
    ],
)
def test_question_preconditions_are_json(
    client: TestClient, changes: dict[str, Any], status: int, code: str
) -> None:
    add_document(client)
    chat_id = new_chat(client)
    r = client.post(f"/api/chats/{chat_id}/messages", json=ask_body(**changes))
    assert (r.status_code, error(r)["code"]) == (status, code)
    assert r.headers["content-type"].startswith("application/json")
    assert messages(client, chat_id) == []


def test_unknown_chat_is_404(client: TestClient) -> None:
    r = client.post(f"/api/chats/{uuid4()}/messages", json=ask_body())
    assert (r.status_code, error(r)["code"]) == (404, "CHAT_NOT_FOUND")


def test_no_documents(client: TestClient) -> None:
    r = client.post(f"/api/chats/{new_chat(client)}/messages", json=ask_body())
    assert (r.status_code, error(r)["code"]) == (409, "NO_DOCUMENTS")


def test_documents_not_ready(client: TestClient) -> None:
    from docchat.adapters.sqlite.document_repository import SqliteDocumentRepository
    from docchat.domain.enums import DocumentKind, DocumentStatus
    from docchat.domain.models import Document

    container = client.app.state.container  # type: ignore[attr-defined]
    now = container.documents._clock.now()
    SqliteDocumentRepository(container.database).insert(
        Document(str(uuid4()), "neu.pdf", DocumentKind.PDF, 1, "f" * 64, DocumentStatus.QUEUED,
                 now, now)
    )  # fmt: skip
    r = client.post(f"/api/chats/{new_chat(client)}/messages", json=ask_body())
    assert (r.status_code, error(r)["code"]) == (409, "DOCUMENTS_NOT_READY")
    assert r.headers["retry-after"] == "3"


def test_budget_exceeded(settings: Settings) -> None:
    with app_client(
        settings.model_copy(update={"daily_budget_usd": 0.0}), FakeLLMClient()
    ) as client:
        add_document(client)
        r = client.post(f"/api/chats/{new_chat(client)}/messages", json=ask_body())
    assert (r.status_code, error(r)["code"]) == (429, "TOKEN_BUDGET_EXCEEDED")
    assert error(r)["params"]["reset_time"].endswith("T00:00:00Z")
    assert int(r.headers["retry-after"]) > 0


@contextmanager
def live(settings: Settings, llm: FakeLLMClient) -> Iterator[httpx2.Client]:
    with (
        live_server(make_app(settings, llm=llm)) as base_url,
        httpx2.Client(base_url=base_url, timeout=10) as http,
    ):
        yield http


def test_busy_lane_concurrency_limit_and_stop(settings: Settings) -> None:
    slow = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.05)
    with live(settings.model_copy(update={"max_concurrent_streams": 1}), slow) as http:
        add_document(http)
        first, second = new_chat(http), new_chat(http)
        with http.stream("POST", f"/api/chats/{first}/messages", json=ask_body()) as running:
            events = parse_events(running.iter_lines())
            next(e for e in events if e.name == "delta")
            busy = http.post(f"/api/chats/{first}/messages", json=ask_body())
            assert (busy.status_code, error(busy)["code"]) == (409, "CHAT_BUSY")
            full = http.post(f"/api/chats/{second}/messages", json=ask_body())
            assert (full.status_code, error(full)["code"]) == (429, "CONCURRENCY_LIMIT")
            assert full.headers["retry-after"] == "5"
            assert http.post(f"/api/chats/{first}/stop", json={}).json() == {"stopped": ["a"]}
            rest = list(events)
        assert terminal(rest).data["status"] == "stopped"
        answer = messages(http, first)[1]
        assert answer["status"] == "stopped" and answer["content"]


def test_stop_without_running_answer(client: TestClient) -> None:
    r = client.post(f"/api/chats/{new_chat(client)}/stop", json={"lane": "b"})
    assert (r.status_code, r.json()) == (202, {"stopped": []})


def test_client_disconnect_leaves_an_interrupted_answer(settings: Settings) -> None:
    slow = FakeLLMClient(default=FakeScenario.SLOW, slow_delay_s=0.05)
    with live(settings, slow) as http:
        add_document(http)
        chat_id = new_chat(http)
        with http.stream("POST", f"/api/chats/{chat_id}/messages", json=ask_body()) as r:
            next(e for e in parse_events(r.iter_lines()) if e.name == "delta")
        deadline = time.monotonic() + 5
        while messages(http, chat_id)[1]["status"] == "streaming":
            assert time.monotonic() < deadline, "answer still streaming"
            time.sleep(0.02)
        answer = messages(http, chat_id)[1]
        assert answer["status"] == "interrupted" and answer["content"]
        assert slow.cancelled == 1


@pytest.mark.parametrize(
    ("scenario", "expected"),
    [
        (FakeScenario.REFUSAL, {"status": "refused", "notices": ["LLM_REFUSED"]}),
        (FakeScenario.MAX_TOKENS, {"status": "truncated", "notices": ["ANSWER_TRUNCATED"]}),
        (FakeScenario.NO_CITATIONS, {"status": "complete", "notices": ["NO_CITATIONS"]}),
        (FakeScenario.FALLBACK, {"status": "complete", "notices": ["MODEL_SWITCHED"]}),
    ],
)
def test_answer_outcomes(
    settings: Settings, scenario: FakeScenario, expected: dict[str, Any]
) -> None:
    with app_client(settings, FakeLLMClient([scenario])) as client:
        add_document(client)
        chat_id = new_chat(client)
        _, events = ask(client, chat_id)
        done = terminal(events)
        assert done.name == "done"
        assert done.data["status"] == expected["status"]
        assert [n["code"] for n in done.data["notices"]] == expected["notices"]
        saved = messages(client, chat_id)[1]
        assert saved["status"] == expected["status"]
        if scenario is FakeScenario.REFUSAL:
            assert saved["content"] == ""


def test_error_mid_stream_is_one_error_event_with_partial(settings: Settings) -> None:
    with app_client(settings, FakeLLMClient([FakeScenario.ERROR_MID_STREAM])) as client:
        add_document(client)
        chat_id = new_chat(client)
        _, events = ask(client, chat_id)
        end = terminal(events)
        assert end.name == "error"
        assert end.data["partial"] is True and end.data["stage"] == "llm"
        body = end.data["error"]
        assert (body["code"], body["retryable"], body["retry_after"]) == ("LLM_OVERLOADED", True, 5)
        assert body["request_id"] == events[0].data["request_id"]
        saved = messages(client, chat_id)[1]
        assert (saved["status"], saved["error_code"]) == ("error", "LLM_OVERLOADED")
        assert saved["content"]


def test_overload_before_the_first_token_is_retried_visibly(settings: Settings) -> None:
    llm = FakeLLMClient([FakeScenario.OVERLOADED, FakeScenario.NORMAL])
    with app_client(settings, llm) as client:
        add_document(client)
        _, events = ask(client, new_chat(client))
    statuses = [e.data for e in events if e.name == "status"]
    assert statuses[-1] == {"phase": "retrying", "attempt": 2}
    assert terminal(events).data["status"] == "complete"


def test_regenerate_replaces_the_failed_answer(settings: Settings) -> None:
    llm = FakeLLMClient([FakeScenario.ERROR_MID_STREAM, FakeScenario.NORMAL])
    with app_client(settings, llm) as client:
        add_document(client)
        chat_id = new_chat(client)
        ask(client, chat_id)
        failed = messages(client, chat_id)[1]
        path = f"/api/chats/{chat_id}/messages/{failed['id']}/regenerate"
        with client.stream("POST", path, json={"locale": "de"}) as r:
            events = list(parse_events(r.iter_lines()))
        assert events[0].data["assistant_message_id"] == failed["id"]
        assert terminal(events).data["status"] == "complete"
        answers = [m for m in messages(client, chat_id) if m["role"] == "assistant"]
        assert [(a["id"], a["status"], a["model"]) for a in answers] == [
            (failed["id"], "complete", "claude-sonnet-5-5")
        ]


def test_regenerate_errors(client: TestClient) -> None:
    add_document(client)
    chat_id = new_chat(client)
    ask(client, chat_id)
    older = messages(client, chat_id)[1]
    ask(client, chat_id, content="Und die Leistung?")
    base = f"/api/chats/{chat_id}/messages"
    stale = client.post(f"{base}/{older['id']}/regenerate", json={"locale": "de"})
    assert (stale.status_code, error(stale)["code"]) == (409, "MESSAGE_NOT_LATEST")
    missing = client.post(f"{base}/{uuid4()}/regenerate", json={"locale": "de"})
    assert (missing.status_code, error(missing)["code"]) == (404, "NOT_FOUND")


def test_without_key_the_stream_has_sources_only(settings: Settings) -> None:
    with app_client(settings) as client:  # provider anthropic, no key: no model
        assert client.get("/api/config").json()["features"]["retrieval_only"] is True
        add_document(client)
        chat_id = new_chat(client)
        _, events = ask(client, chat_id)
    assert [e.name for e in events] == ["meta", "status", "sources", "done"]
    assert events[2].data["mode"] == "retrieval_only" and events[2].data["sources"]
    done = events[-1].data
    assert done["status"] == "sources_only" and done["stop_reason"] is None
    assert [n["code"] for n in done["notices"]] == ["LLM_NOT_CONFIGURED"]
    assert done["usage"] is None and done["cost_usd"] == 0


def test_fake_provider_with_scenario_marker(settings: Settings) -> None:
    fake = settings.model_copy(update={"llm_provider": "fake"})
    with TestClient(make_app(fake)) as client:
        config = client.get("/api/config").json()
        assert (config["llm_status"], config["features"]["retrieval_only"]) == ("ok", False)
        add_document(client)
        chat_id = new_chat(client)
        _, normal = ask(client, chat_id)
        _, refused = ask(client, chat_id, content="Warum? #fake:refusal")
    assert terminal(normal).data["status"] == "complete"
    assert [e.name for e in normal].count("citation") == 1
    assert terminal(refused).data["status"] == "refused"


def test_config_lists_the_models(client: TestClient) -> None:
    config = client.get("/api/config").json()
    assert config["default_model"] == "claude-sonnet-5-5"
    assert config["limits"]["max_question_chars"] == 4000
    by_id = {m["id"]: m for m in config["models"]}
    assert set(by_id) == {"claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"}
    assert by_id["claude-haiku-4-5"]["efforts"] == []
    assert by_id["claude-sonnet-5-5"] | {"efforts": None} == {
        "id": "claude-sonnet-5-5",
        "label": "Claude Sonnet 5.5",
        "tier": "balanced",
        "input_usd_per_mtok": 2.0,
        "output_usd_per_mtok": 10.0,
        "cache_read_usd_per_mtok": 0.2,
        "efforts": None,
        "default_effort": "low",
        "available": True,
    }


def test_logs_never_contain_question_or_answer(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    secret_question = "Welche Schutzart hat die geheime Leuchte Zephyr-Omega?"
    add_document(client, DATASHEET + "\nDie Zephyr-Omega ist streng geheim und hat IP69K.\n")
    chat_id = new_chat(client)
    with caplog.at_level(logging.DEBUG):
        _, events = ask(client, chat_id, content=secret_question)
        client.get(f"/api/chats/{chat_id}/messages")
    answer = "".join(e.data["text"] for e in events if e.name == "delta")
    assert "Laut deinen Dokumenten" in answer
    logged = "\n".join(f"{r.getMessage()} {vars(r)}" for r in caplog.records)
    assert "answer_finished" in logged
    for secret in (secret_question, "Zephyr", "Laut deinen Dokumenten", "IP66"):
        assert secret not in logged


def test_comparison_lanes_same_model_and_prefer(client: TestClient) -> None:
    add_document(client)
    chat_id = new_chat(client)
    client_id, comparison = str(uuid4()), str(uuid4())

    def lane(name: str, model: str) -> tuple[Response, list[Event]]:
        body = {"comparison": {"id": comparison, "lane": name}, "client_message_id": client_id}
        return ask(client, chat_id, model=model, **body)

    r, events_a = lane("a", "claude-sonnet-5-5")
    assert r.status_code == 200 and events_a[0].data["comparison_id"] == comparison
    r, _ = lane("b", "claude-sonnet-5-5")
    assert r.status_code == 422 and error(r)["code"] == "COMPARE_SAME_MODEL"
    r, events_b = lane("b", "claude-opus-5-5")
    assert r.status_code == 200 and events_b[0].data["lane"] == "b"

    b_id = events_b[0].data["assistant_message_id"]
    r = client.post(f"/api/chats/{chat_id}/messages/{b_id}/prefer")
    assert r.status_code == 204
    kept = {
        m["lane"]: m["is_preferred"] for m in messages(client, chat_id) if m["role"] == "assistant"
    }
    assert kept == {"a": False, "b": True}

    r = client.post(f"/api/chats/{chat_id}/messages/{uuid4()}/prefer")
    assert r.status_code == 404 and error(r)["code"] == "NOT_FOUND"
