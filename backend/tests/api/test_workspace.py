"""Preferences, workspace statistics, delete everything and export over HTTP."""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from docchat.adapters.fake_llm import FakeLLMClient
from docchat.core.config import Settings
from tests.api.test_chats import add_document, ask, new_chat
from tests.support import make_app

VALID: dict[str, Any] = {
    "locale": "en",
    "theme": "dark",
    "name": "Luca",
    "default_model": "claude-opus-5-5",
    "effort": "medium",
    "style": "detailed",
    "compare_models": ["claude-sonnet-5-5", "claude-haiku-4-5"],
    "onboarded": True,
    "retention_days": 30,
}


@pytest.fixture
def client(settings: Settings) -> Any:
    with TestClient(make_app(settings, llm=FakeLLMClient())) as c:
        yield c


def _code(r: Any) -> str:
    return str(r.json()["error"]["code"])


def test_preferences_start_with_defaults(client: TestClient) -> None:
    body = client.get("/api/preferences").json()
    assert body["onboarded"] is False
    assert body["default_model"] == "claude-sonnet-5-5"
    assert body["name"] == ""


def test_preferences_round_trip(client: TestClient) -> None:
    r = client.put("/api/preferences", json=VALID)
    assert r.status_code == 200, r.text
    assert r.json() == VALID
    assert client.get("/api/preferences").json() == VALID


def test_name_is_cleaned(client: TestClient) -> None:
    r = client.put("/api/preferences", json=VALID | {"name": "  Lu\u0000ca\u202e \u200b"})
    assert r.json()["name"] == "Luca"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"locale": "fr"}, "VALIDATION_ERROR"),
        ({"theme": "pink"}, "VALIDATION_ERROR"),
        ({"name": "x" * 41}, "VALIDATION_ERROR"),
        ({"style": "long"}, "VALIDATION_ERROR"),
        ({"effort": "max"}, "VALIDATION_ERROR"),
        ({"compare_models": ["claude-opus-5-5"]}, "VALIDATION_ERROR"),
        ({"compare_models": ["claude-opus-5-5", "claude-opus-5-5"]}, "VALIDATION_ERROR"),
        ({"default_model": "gpt-5"}, "MODEL_NOT_ALLOWED"),
        ({"compare_models": ["claude-opus-5-5", "gpt-5"]}, "MODEL_NOT_ALLOWED"),
        ({"extra": 1}, "VALIDATION_ERROR"),
        ({"retention_days": -1}, "VALIDATION_ERROR"),
        ({"retention_days": 99999}, "VALIDATION_ERROR"),
    ],
)
def test_preferences_validation(client: TestClient, change: dict[str, Any], code: str) -> None:
    r = client.put("/api/preferences", json=VALID | change)
    assert r.status_code == 422, r.text
    assert _code(r) == code
    assert client.get("/api/preferences").json()["onboarded"] is False  # nothing saved


def test_a_partial_body_is_rejected(client: TestClient) -> None:
    r = client.put("/api/preferences", json={"locale": "en"})
    assert r.status_code == 422 and _code(r) == "VALIDATION_ERROR"


def test_workspace_statistics(client: TestClient) -> None:
    add_document(client)
    new_chat(client)
    body = client.get("/api/workspace").json()
    assert body["stats"]["documents"] == 1
    assert body["stats"]["chats"] == 1
    assert body["stats"]["storage_bytes"] >= body["stats"]["documents_bytes"] > 0
    assert body["usage_today"]["requests"] == 0
    assert body["retention_days"] is None


def test_retention_is_reported(settings: Settings) -> None:
    with TestClient(make_app(settings.model_copy(update={"retention_days": 30}))) as c:
        assert c.get("/api/workspace").json()["retention_days"] == 30


def test_delete_everything(client: TestClient, settings: Settings) -> None:
    add_document(client)
    chat_id = new_chat(client)
    r, _ = ask(client, chat_id)
    assert r.status_code == 200
    client.put("/api/preferences", json=VALID)

    assert client.delete("/api/workspace").status_code == 204
    assert client.get("/api/documents").json()["documents"] == []
    assert client.get("/api/chats").json()["chats"] == []
    assert client.get("/api/preferences").json()["name"] == "Luca"
    uploads = Path(settings.uploads_dir)
    assert [p for p in uploads.rglob("*") if p.is_file()] == []

    assert client.delete("/api/workspace?reset_preferences=true").status_code == 204
    assert client.get("/api/preferences").json()["onboarded"] is False


def test_deleting_a_document_redacts_its_cited_text(client: TestClient) -> None:
    document_id = add_document(client)
    chat_id = new_chat(client)
    ask(client, chat_id)
    before = client.get(f"/api/chats/{chat_id}/messages").json()["messages"][1]
    assert before["citations"][0]["cited_text"]

    assert client.delete(f"/api/documents/{document_id}").status_code == 204
    after = client.get(f"/api/chats/{chat_id}/messages").json()["messages"][1]
    assert after["sources"][0]["deleted"] is True
    assert after["sources"][0]["snippet"] == ""
    assert after["sources"][0]["filename"] == before["sources"][0]["filename"]
    assert all(c["cited_text"] == "" for c in after["citations"])
    assert after["content"] == before["content"]


def test_export_zip(client: TestClient) -> None:
    add_document(client)
    chat_id = new_chat(client)
    ask(client, chat_id)
    client.put("/api/preferences", json=VALID)

    r = client.get("/api/workspace/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    disposition = r.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="siteco-document-chat-')
    assert r.headers["cache-control"] == "no-store"
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    names = archive.namelist()
    assert {"preferences.json", "documents.json"} <= set(names)
    [record_name] = [n for n in names if n.endswith(".json") and n.startswith("chats/")]
    record = json.loads(archive.read(record_name))
    assert [m["role"] for m in record["messages"]] == ["user", "assistant"]
    assert json.loads(archive.read("preferences.json"))["locale"] == "en"
    assert any(n.endswith(".md") for n in names)


def test_the_name_never_reaches_the_model(settings: Settings) -> None:
    llm = FakeLLMClient()
    with TestClient(make_app(settings, llm=llm)) as c:
        c.put("/api/preferences", json=VALID | {"name": "Zacharias"})
        add_document(c)
        ask(c, new_chat(c))
    assert llm.requests
    assert all("Zacharias" not in repr(request) for request in llm.requests)


def test_retention_is_chosen_in_the_app(client: TestClient) -> None:
    assert client.get("/api/workspace").json()["retention_days"] is None
    assert client.put("/api/preferences", json=VALID | {"retention_days": 90}).status_code == 200
    assert client.get("/api/workspace").json()["retention_days"] == 90
    assert client.delete("/api/workspace?reset_preferences=true").status_code == 204
    assert client.get("/api/preferences").json()["retention_days"] == 0


def test_a_client_that_does_not_send_retention_keeps_the_choice(client: TestClient) -> None:
    """Regression: older clients (the E2E reset, a desktop app) send the object without it."""
    assert client.put("/api/preferences", json=VALID | {"retention_days": 90}).status_code == 200
    older = {k: v for k, v in VALID.items() if k != "retention_days"}
    r = client.put("/api/preferences", json=older | {"name": "Anna"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["retention_days"]) == ("Anna", 90)
