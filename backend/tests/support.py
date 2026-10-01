"""Shared test helpers for building the app with test doubles."""

from collections.abc import Callable

from fastapi import FastAPI

from docchat.adapters.system_clock import SystemClock
from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.domain.ports import Embedder, KeyValidator, LLMClient, MalwareScanner
from docchat.main import create_app
from tests.fakes import FakeEmbedder, FakeKeyValidator, FakeScanner


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
