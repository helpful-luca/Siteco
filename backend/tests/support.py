"""Shared test helpers for building the app with test doubles."""

from fastapi import FastAPI

from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.domain.ports import Embedder, LLMClient, MalwareScanner
from docchat.main import create_app
from tests.fakes import FakeEmbedder


def make_app(
    settings: Settings,
    *,
    embedder: Embedder | None = None,
    scanner: MalwareScanner | None = None,
    llm: LLMClient | None = None,
) -> FastAPI:
    container = build_container(
        settings, embedder=embedder or FakeEmbedder(), scanner=scanner, llm=llm
    )
    return create_app(settings, container)
