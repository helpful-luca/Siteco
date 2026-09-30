"""Application factory. Wiring only, no business logic."""

from fastapi import FastAPI

from docchat.api.error_handlers import register_error_handlers
from docchat.api.middleware import InternalTokenMiddleware, RequestContextMiddleware
from docchat.api.routes import system
from docchat.core.config import Settings, get_settings
from docchat.core.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="Siteco Document Chat API", version=settings.app_version)
    register_error_handlers(app)
    app.include_router(system.router)
    token = settings.internal_token.get_secret_value() if settings.internal_token else None
    app.add_middleware(InternalTokenMiddleware, token=token)
    app.add_middleware(RequestContextMiddleware)  # added last, so it runs outermost
    return app
