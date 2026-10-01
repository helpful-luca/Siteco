"""Documents uploaded into a chat: not in the library, searched only in their chat."""

from collections.abc import Iterator
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from docchat.adapters.fake_llm import FakeLLMClient
from docchat.core.config import Settings
from tests.api.test_chats import DATASHEET, add_document, ask, new_chat
from tests.api.test_documents import error, wait_until_settled
from tests.support import make_app


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(make_app(settings, llm=FakeLLMClient())) as c:
        yield c


def attach(client: TestClient, chat_id: str, name: str, data: bytes) -> Response:
    return client.post(
        "/api/documents",
        params={"chat_id": chat_id},
        content=data,
        headers={"X-File-Name": quote(name), "Content-Type": "application/octet-stream"},
    )


def attachments(client: TestClient, chat_id: str) -> list[str]:
    r = client.get(f"/api/chats/{chat_id}/attachments")
    assert r.status_code == 200, r.text
    return [d["id"] for d in r.json()["documents"]]


def test_upload_into_a_chat_stays_out_of_the_library(client: TestClient) -> None:
    chat_id = new_chat(client)
    r = attach(client, chat_id, "anhang.md", DATASHEET.encode())
    assert r.status_code == 202, r.text
    document = r.json()["document"]
    assert document["in_library"] is False
    assert wait_until_settled(client, document["id"])["status"] == "ready"
    assert client.get("/api/documents").json()["documents"] == []
    assert attachments(client, chat_id) == [document["id"]]


def test_the_chat_answers_from_its_attachment_and_others_do_not(client: TestClient) -> None:
    chat_id, other = new_chat(client), new_chat(client)
    document_id = attach(client, chat_id, "anhang.md", DATASHEET.encode()).json()["document"]["id"]
    wait_until_settled(client, document_id)
    r, _ = ask(client, chat_id)
    assert r.status_code == 200
    r, _ = ask(client, other)
    assert (r.status_code, error(r)["code"]) == (409, "NO_DOCUMENTS")


def test_promote_puts_an_attachment_into_the_library(client: TestClient) -> None:
    chat_id = new_chat(client)
    document_id = attach(client, chat_id, "anhang.md", DATASHEET.encode()).json()["document"]["id"]
    r = client.post(f"/api/documents/{document_id}/library")
    assert r.status_code == 200, r.text
    assert r.json()["document"]["in_library"] is True
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [document_id]
    assert attachments(client, chat_id) == [document_id]  # still listed in its chat
    assert client.post(f"/api/documents/{document_id}/library").status_code == 200


def test_promote_unknown_document_is_not_found(client: TestClient) -> None:
    r = client.post("/api/documents/00000000-0000-4000-8000-000000000000/library")
    assert (r.status_code, error(r)["code"]) == (404, "NOT_FOUND")


def test_unknown_chat_is_refused(client: TestClient) -> None:
    missing = "00000000-0000-4000-8000-000000000000"
    r = attach(client, missing, "anhang.md", DATASHEET.encode())
    assert (r.status_code, error(r)["code"]) == (404, "CHAT_NOT_FOUND")
    r = client.get(f"/api/chats/{missing}/attachments")
    assert (r.status_code, error(r)["code"]) == (404, "CHAT_NOT_FOUND")


def test_the_same_file_in_a_chat_attaches_the_library_document(client: TestClient) -> None:
    library_id = add_document(client)
    chat_id = new_chat(client)
    r = attach(client, chat_id, "kopie.md", DATASHEET.encode())
    assert r.status_code == 202, r.text
    assert r.json()["document"]["id"] == library_id
    assert attachments(client, chat_id) == [library_id]


def test_deleting_the_chat_deletes_its_attachments_only(client: TestClient) -> None:
    library_id = add_document(client)
    chat_id = new_chat(client)
    only = attach(client, chat_id, "nur hier.md", b"# Nur hier\n\nEin Text.").json()["document"]
    assert client.delete(f"/api/chats/{chat_id}").status_code == 204
    assert client.get(f"/api/documents/{only['id']}").status_code == 404
    assert client.get(f"/api/documents/{library_id}").status_code == 200


def test_removing_an_attachment_from_its_chat(client: TestClient, settings: Settings) -> None:
    library_id = add_document(client)
    chat_id = new_chat(client)
    only = attach(client, chat_id, "nur hier.md", b"# Nur hier\n\nEin Text.").json()["document"]
    attach(client, chat_id, "kopie.md", DATASHEET.encode())  # the library document
    assert client.delete(f"/api/chats/{chat_id}/attachments/{only['id']}").status_code == 204
    assert client.get(f"/api/documents/{only['id']}").status_code == 404
    assert not (settings.uploads_dir / f"{only['id']}.md").exists()
    assert client.delete(f"/api/chats/{chat_id}/attachments/{library_id}").status_code == 204
    assert client.get(f"/api/documents/{library_id}").status_code == 200  # stays in the library
    assert attachments(client, chat_id) == []
    r = client.delete(f"/api/chats/{chat_id}/attachments/{library_id}")
    assert (r.status_code, error(r)["code"]) == (404, "NOT_FOUND")
