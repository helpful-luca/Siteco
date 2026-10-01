"""Prints the HTTP contract as JSON. Frontend types are generated from this output."""

import json
from collections.abc import Sequence
from typing import Any

from pydantic.json_schema import models_json_schema

from docchat.api.schemas.answer_events import SSE_EVENT_MODELS
from docchat.api.schemas.common import ErrorEnvelope
from docchat.core.config import Settings
from docchat.core.container import build_container
from docchat.domain.errors import ERROR_SPECS
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
    # Error envelopes are returned by exception handlers and answer events travel inside an
    # event stream, so FastAPI does not list them itself.
    _, extra = models_json_schema(
        [(ErrorEnvelope, "validation"), *((m, "serialization") for m in SSE_EVENT_MODELS)],
        ref_template="#/components/schemas/{model}",
    )
    schemas = spec.setdefault("components", {}).setdefault("schemas", {})
    schemas.update(extra.get("$defs", {}))
    # Status and retryable per code, so the frontend error catalog is checked against
    # `domain/errors.py` (the contract itself has a drift test).
    schemas["ErrorCode"]["x-error-specs"] = {
        code.value: {"status": spec.status, "retryable": spec.retryable}
        for code, spec in ERROR_SPECS.items()
    }
    return spec


def main() -> None:
    print(json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False))


if __name__ == "__main__":
    main()
