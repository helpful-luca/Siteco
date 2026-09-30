"""Shared test helpers for building the app with test doubles."""

from fastapi import FastAPI

from docchat.core.config import Settings
from docchat.main import create_app


def make_app(settings: Settings) -> FastAPI:
    return create_app(settings)
