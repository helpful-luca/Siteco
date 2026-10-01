"""Application factory. Wiring only, no business logic."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from docchat.api.error_handlers import register_error_handlers
from docchat.api.mcp_endpoint import McpGateway, build_mcp_app
from docchat.api.middleware import (
    BodyLimitMiddleware,
    InternalTokenMiddleware,
    RequestContextMiddleware,
)
from docchat.api.routes import chats, documents, system, workspace
from docchat.api.routes import settings as app_settings
from docchat.core.config import Settings, get_settings
from docchat.core.container import Container, build_container
from docchat.core.logging import configure_logging


def create_app(settings: Settings | None = None, container: Container | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    app_container = container or build_container(settings)

    mcp_app = build_mcp_app(app_container.library)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await app_container.start()
        async with mcp_app.router.lifespan_context(mcp_app):  # starts the MCP session manager
            yield
        await app_container.stop()

    app = FastAPI(title="Siteco Document Chat API", version=settings.app_version, lifespan=lifespan)
    app.state.container = app_container
    register_error_handlers(app)
    app.include_router(system.router)
    app.include_router(documents.router)
    app.include_router(chats.router)
    app.include_router(workspace.router)
    app.include_router(app_settings.router)
    token = settings.internal_token.get_secret_value() if settings.internal_token else None
    mcp_token = settings.mcp_token.get_secret_value() if settings.mcp_token else None
    app.add_middleware(McpGateway, mcp_app=mcp_app, token=mcp_token)  # innermost
    app.add_middleware(
        BodyLimitMiddleware,
        max_bytes=settings.max_json_body_kb * 1024,
        exempt=(("POST", "/api/documents"),),  # the raw upload, limited by MAX_UPLOAD_MB
    )
    app.add_middleware(InternalTokenMiddleware, token=token)
    app.add_middleware(RequestContextMiddleware)  # added last, so it runs outermost
    return app
