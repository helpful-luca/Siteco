# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
# No onnxruntime telemetry to Microsoft, in any stage (see src/docchat/__init__.py).
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 \
    ORT_DISABLE_TELEMETRY=1
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /usr/local/bin/uv
WORKDIR /app

# Third-party dependencies only: this layer changes only when uv.lock changes.
FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

# Embedding model: besides the locked dependencies it depends only on the files that download
# and verify it, so application code changes never trigger the ~400 MB download again.
FROM deps AS model
COPY src/docchat/__init__.py src/docchat/__init__.py
COPY src/docchat/adapters/__init__.py src/docchat/adapters/fastembed_embedder.py src/docchat/adapters/
COPY src/docchat/cli/__init__.py src/docchat/cli/download_model.py src/docchat/cli/
ENV EMBEDDING_CACHE_DIR=/opt/models PYTHONPATH=/app/src
RUN /app/.venv/bin/python -m docchat.cli.download_model

# Application installed as a regular (non-editable) package into the venv.
FROM deps AS app
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-editable

FROM python:3.12-slim AS runtime
ARG GIT_SHA=dev
ARG APP_VERSION=0.1.0
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    ORT_DISABLE_TELEMETRY=1 HF_HUB_OFFLINE=1 EMBEDDING_CACHE_DIR=/opt/models DATA_DIR=/data \
    GIT_SHA=$GIT_SHA APP_VERSION=$APP_VERSION
RUN useradd --uid 10001 --create-home app && mkdir -p /data && chown app:app /data
COPY --from=model /opt/models /opt/models
COPY --from=app /app/.venv /app/.venv
WORKDIR /app
USER app
EXPOSE 8000
CMD ["uvicorn", "docchat.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
