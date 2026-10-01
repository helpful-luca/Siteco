"""Shared test helpers: the app with test doubles, a real server for streaming, SSE parsing and
waiting for background work."""

import asyncio
import json
import socket
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import uvicorn
from fastapi import FastAPI

from docchat.adapters.system_clock import SystemClock
from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.domain.ports import Embedder, KeyValidator, LLMClient, MalwareScanner
from docchat.main import create_app
from tests.fakes import FakeEmbedder, FakeKeyValidator, FakeScanner

PATIENCE_S = 10.0


def make_app(
    settings: Settings,
    *,
    embedder: Embedder | None = None,
    scanner: MalwareScanner | None = None,
    llm: LLMClient | None = None,
    clock: SystemClock | None = None,
    key_validator: KeyValidator | None = None,
    url_is_public: Callable[[str], bool] | None = None,
) -> FastAPI:
    container = build_container(
        settings,
        embedder=embedder or FakeEmbedder(),
        scanner=scanner or FakeScanner(),
        llm=llm,
        clock=clock,
        key_validator=key_validator or FakeKeyValidator(),  # never a call to Anthropic
        url_is_public=url_is_public,
    )
    return create_app(settings, container)


@contextmanager
def live_server(app: FastAPI) -> Iterator[str]:
    """A real uvicorn server in a thread. Starlette's TestClient buffers whole responses, so
    streaming behaviour (a busy lane, a client that disconnects) needs a real socket."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_config=None, lifespan="on"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("live server did not start")
        time.sleep(0.01)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


@dataclass(frozen=True)
class Event:
    name: str
    data: dict[str, Any]


def parse_events(lines: Iterable[str]) -> Iterator[Event]:
    """Reads a `text/event-stream` body into events, the way a browser client would."""
    name, data = "message", []
    for line in lines:
        if line == "":
            if data:
                yield Event(name, json.loads("\n".join(data)))
            name, data = "message", []
        elif line.startswith(":"):
            continue  # keepalive comment
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    if data:
        yield Event(name, json.loads("\n".join(data)))


async def eventually(condition: Callable[[], bool], timeout_s: float = PATIENCE_S) -> None:
    """Polls until `condition` holds. The limit only catches a hang; a slow machine just waits."""
    async with asyncio.timeout(timeout_s):
        while not condition():
            await asyncio.sleep(0.01)
