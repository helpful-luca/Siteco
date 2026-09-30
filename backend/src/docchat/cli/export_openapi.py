"""Prints the HTTP contract as JSON. Frontend types are generated from this output."""

import json
from collections.abc import Sequence
from typing import Any

from pydantic.json_schema import models_json_schema

from docchat.api.schemas.common import ErrorEnvelope
from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.main import create_app


class _UnusedEmbedder:
    """The contract never runs requests, so no model is loaded."""

    dim = 0

    def load(self) -> None:
        return None

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return []

    def embed_query(self, text: str) -> list[float]:
        return []


def build_openapi() -> dict[str, Any]:
    # Ignore any local .env: the contract must not depend on the machine it is built on.
    settings = Settings(_env_file=None, app_version="contract")  # type: ignore[call-arg]
    app = create_app(settings, build_container(settings, embedder=_UnusedEmbedder()))
    spec = app.openapi()
    # Error envelopes are returned by exception handlers, so FastAPI does not list them itself.
    _, extra = models_json_schema(
        [(ErrorEnvelope, "validation")], ref_template="#/components/schemas/{model}"
    )
    spec.setdefault("components", {}).setdefault("schemas", {}).update(extra.get("$defs", {}))
    return spec


def main() -> None:
    print(json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False))


if __name__ == "__main__":
    main()
