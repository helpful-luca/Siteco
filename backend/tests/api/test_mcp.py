"""MCP server on /api/mcp, driven by the SDK's own client against the ASGI app."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from pydantic import SecretStr

from docchat.core.config import Settings
from tests.pdf_factory import build_pdf, text_page
from tests.support import make_app

URL = "http://localhost/api/mcp"
PDF = build_pdf([text_page("Die Leuchte Mira hat IP66."), text_page("Sie liefert 5000 Lumen.")])


@asynccontextmanager
async def running(settings: Settings, **headers: str) -> AsyncIterator[httpx2.AsyncClient]:
    app = make_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx2.ASGITransport(app=app)
        async with httpx2.AsyncClient(
            transport=transport, base_url="http://localhost", headers=headers
        ) as http:
            yield http


async def upload_ready(http: httpx2.AsyncClient, name: str = "Mira.pdf") -> str:
    r = await http.post(
        "/api/documents",
        content=PDF,
        headers={"X-File-Name": quote(name), "Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 202, r.text
    doc_id: str = r.json()["document"]["id"]
    for _ in range(600):
        document = (await http.get(f"/api/documents/{doc_id}")).json()["document"]
        if document["status"] == "ready":
            return doc_id
        assert document["status"] != "failed"
        await asyncio.sleep(0.05)
    raise AssertionError("document did not become ready")


def structured(result: Any) -> list[dict[str, Any]]:
    assert not result.is_error, result
    items: list[dict[str, Any]] = result.structured_content["result"]
    return items


async def test_list_and_search_with_the_sdk_client(settings: Settings) -> None:
    async with running(settings) as http:
        doc_id = await upload_ready(http)
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            tools = {t.name for t in (await client.list_tools()).tools}
            assert tools == {"list_documents", "search_documents"}

            documents = structured(await client.call_tool("list_documents", {}))
            assert [(d["id"], d["filename"], d["kind"], d["pages"]) for d in documents] == [
                (doc_id, "Mira.pdf", "pdf", 2)
            ]

            found = structured(
                await client.call_tool("search_documents", {"query": "Lumen", "top_k": 3})
            )
            assert found
            assert found[0]["filename"] == "Mira.pdf"
            assert found[0]["page"] in (1, 2)
            assert found[0]["source_id"] and "Lumen" in " ".join(p["text"] for p in found)

            narrowed = await client.call_tool(
                "search_documents", {"query": "Lumen", "document_ids": ["unknown"]}
            )
            assert structured(narrowed) == []


async def test_invalid_query_is_a_tool_error_not_a_crash(settings: Settings) -> None:
    async with (
        running(settings) as http,
        Client(streamable_http_client(URL, http_client=http)) as client,
    ):
        result = await client.call_tool("search_documents", {"query": "  "})
        assert result.is_error


async def test_foreign_origin_is_refused(settings: Settings) -> None:
    async with running(settings) as http:
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        evil = await http.post(URL, json=body, headers={"Origin": "https://evil.example"})
        assert evil.status_code == 403
        local = await http.post(
            URL,
            json=body,
            headers={"Origin": "http://localhost:3000", "Accept": "application/json"},
        )
        assert local.status_code != 403


async def test_token_is_off_by_default_and_required_when_set(settings: Settings) -> None:
    secured = settings.model_copy(update={"mcp_token": SecretStr("s3cret")})
    async with running(secured) as http:
        assert (await http.post(URL, json={})).status_code == 401
        bad = await http.post(URL, json={}, headers={"Authorization": "Bearer nope"})
        assert bad.status_code == 401
        assert bad.headers["www-authenticate"] == "Bearer"
        # Other routes are not affected by the MCP token.
        assert (await http.get("/api/health/live")).status_code == 200
    async with (
        running(secured, Authorization="Bearer s3cret") as http,
        Client(streamable_http_client(URL, http_client=http)) as client,
    ):
        assert len((await client.list_tools()).tools) == 2


@pytest.mark.parametrize("method", ["GET", "DELETE"])
async def test_stateless_server_has_no_sessions(settings: Settings, method: str) -> None:
    async with running(settings) as http:
        r = await http.request(method, URL)
        assert r.status_code == 405
        assert r.headers["allow"] == "POST"
