"""Import from a link against a local HTTP server. The tests allow exactly 127.0.0.1 as a
"public" address for the server; with the real policy the same URL is blocked."""

import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient

from docchat.core.config import Settings
from tests.api.test_chats import new_chat
from tests.api.test_documents import wait_until_settled
from tests.pdf_factory import build_pdf, text_page
from tests.support import make_app

PDF = build_pdf([text_page("Die Leuchte Mira hat die Schutzart IP66.")])
PAGE = b"<!DOCTYPE html><html><head><title>Mira</title></head><body><h1>Mira L</h1><p>Schutzart IP66.</p></body></html>"  # noqa: E501


class _Handler(BaseHTTPRequestHandler):
    seen: ClassVar[list[dict[str, str]]] = []

    def do_GET(self) -> None:
        type(self).seen.append({k.lower(): v for k, v in self.headers.items()})
        if self.path.startswith("/katalog.pdf"):
            self._send(200, PDF, "application/pdf", length=True)
        elif self.path == "/seite":
            self._send(200, PAGE, "text/html; charset=utf-8", length=False)
        elif self.path == "/weiter":
            self._redirect("/katalog.pdf")
        elif self.path == "/metadaten":
            self._redirect("http://169.254.169.254/latest/meta-data/")
        elif self.path == "/bild":
            self._send(200, b"\x89PNG\r\n", "image/png", length=True)
        else:
            self._send(404, b"nope", "text/plain", length=True)

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, status: int, body: bytes, content_type: str, *, length: bool) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length:
            self.send_header("Content-Length", str(len(body)))
        else:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture
def server() -> Iterator[str]:
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    _Handler.seen = []
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = make_app(settings, url_is_public=lambda address: address == "127.0.0.1")
    with TestClient(app) as c:
        yield c


def start(client: TestClient, url: str, **body: Any) -> dict[str, Any]:
    r = client.post("/api/documents/import-url", json={"url": url, **body})
    assert r.status_code == 202, r.text
    job: dict[str, Any] = r.json()["job"]
    return job


def settle(client: TestClient, job_id: str, timeout: float = 20) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job: dict[str, Any] = client.get(f"/api/documents/imports/{job_id}").json()["job"]
        if job["state"] != "downloading":
            return job
        time.sleep(0.05)
    raise AssertionError("import did not finish")


def test_a_pdf_from_a_link_is_scanned_and_ingested_like_an_upload(
    client: TestClient, server: str
) -> None:
    job = settle(client, start(client, f"{server}/katalog.pdf?_=17")["id"])
    assert job["state"] == "done", job
    assert (job["received_bytes"], job["total_bytes"]) == (len(PDF), len(PDF))
    document = wait_until_settled(client, job["document"]["id"])
    assert (document["status"], document["filename"]) == ("ready", "katalog.pdf")
    assert document["source_url"] == f"{server}/katalog.pdf?_=17"
    assert [d["id"] for d in client.get("/api/documents").json()["documents"]] == [document["id"]]
    request = _Handler.seen[0]
    assert request["user-agent"].startswith("SitecoDocChat/")
    assert "cookie" not in request and "authorization" not in request


def test_a_redirect_is_followed_and_checked(client: TestClient, server: str) -> None:
    assert settle(client, start(client, f"{server}/weiter")["id"])["state"] == "done"
    blocked = settle(client, start(client, f"{server}/metadaten")["id"])
    assert (blocked["state"], blocked["error_code"]) == ("failed", "URL_BLOCKED")


def test_an_html_page_into_a_chat_only(client: TestClient, server: str) -> None:
    chat_id = new_chat(client)
    job = settle(client, start(client, f"{server}/seite", library=False, chat_id=chat_id)["id"])
    document = job["document"]
    assert (document["kind"], document["filename"], document["in_library"]) == (
        "html", "seite.html", False,
    )  # fmt: skip
    assert job["total_bytes"] is None
    assert client.get("/api/documents").json()["documents"] == []
    listed = client.get(f"/api/chats/{chat_id}/attachments").json()["documents"]
    assert [d["id"] for d in listed] == [document["id"]]


@pytest.mark.parametrize(
    ("path", "code"), [("/bild", "URL_UNSUPPORTED_TYPE"), ("/fehlt", "URL_UNREACHABLE")]
)
def test_failures_end_in_the_job(client: TestClient, server: str, path: str, code: str) -> None:
    job = settle(client, start(client, f"{server}{path}")["id"])
    assert (job["state"], job["error_code"]) == ("failed", code)


def test_with_the_real_policy_local_addresses_are_refused_at_once(
    settings: Settings, server: str
) -> None:
    with TestClient(make_app(settings)) as c:
        for url, code in [
            (f"{server}/katalog.pdf", "URL_BLOCKED"),
            ("http://localhost:8000/api/health/ready", "URL_BLOCKED"),
            ("http://backend:8000/", "URL_BLOCKED"),
            ("http://[::1]:3000/", "URL_BLOCKED"),
            ("file:///etc/passwd", "URL_INVALID"),
            ("https://user:pw@example.com/a.pdf", "URL_INVALID"),
        ]:
            r = c.post("/api/documents/import-url", json={"url": url})
            assert (r.status_code, r.json()["error"]["code"]) == (422, code), url
    assert _Handler.seen == []


def test_unknown_and_cancelled_jobs(client: TestClient, server: str) -> None:
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"/api/documents/imports/{missing}").status_code == 404
    job = start(client, f"{server}/katalog.pdf")
    assert client.delete(f"/api/documents/imports/{job['id']}").status_code == 204
    assert client.get(f"/api/documents/imports/{job['id']}").status_code == 404
