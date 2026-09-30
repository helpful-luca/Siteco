"""Pure ASGI middlewares. Unlike BaseHTTPMiddleware they are safe for streaming responses."""

import hmac
import logging
import re
import time

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from docchat.api.schemas.common import error_response
from docchat.core.logging import new_request_id, request_id_var
from docchat.domain.errors import ErrorCode

log = logging.getLogger("docchat.access")

_REQUEST_ID = re.compile(r"req_[a-z0-9]{8}")
_TOKEN_EXEMPT_PREFIXES = ("/api/health/",)


def _header(scope: Scope, name: bytes) -> str:
    for key, value in scope.get("headers", []):
        if key == name:
            return str(value.decode("latin-1"))
    return ""


class RequestContextMiddleware:
    """Sets the request id, echoes it as a header and writes one access log line."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = _header(scope, b"x-request-id")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else new_request_id()
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            # Handled here, not by a FastAPI exception handler: those run outside this
            # middleware, after the request id is gone. A started stream cannot be replaced.
            log.exception("unhandled_exception")
            if response_started:
                raise
            response = error_response(ErrorCode.INTERNAL_ERROR, "Unexpected server error.")
            await response(scope, receive, send_with_request_id)
        finally:
            log.info(
                "request",
                extra={
                    "method": scope["method"],
                    "route": scope["path"],
                    "status": status,
                    "latency_ms": round((time.perf_counter() - started) * 1000),
                },
            )
            request_id_var.reset(token)


class InternalTokenMiddleware:
    """Optional shared secret between the Next.js proxy and the backend."""

    def __init__(self, app: ASGIApp, token: str | None) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or self.token is None
            or scope["path"].startswith(_TOKEN_EXEMPT_PREFIXES)
            or hmac.compare_digest(_header(scope, b"x-internal-token"), self.token)
        ):
            await self.app(scope, receive, send)
            return
        response = error_response(
            ErrorCode.UNAUTHORIZED_CLIENT, "Missing or invalid internal token."
        )
        await response(scope, receive, send)


class BodyLimitMiddleware:
    """JSON bodies are small (annex 10, P5). The declared length is checked before anything is
    read, the received bytes while reading (a chunked body declares none). Uploads have their
    own limit in the upload service and are exempt."""

    def __init__(self, app: ASGIApp, max_bytes: int, exempt: tuple[tuple[str, str], ...]) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.exempt = exempt

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or (scope["method"], scope["path"]) in self.exempt:
            await self.app(scope, receive, send)
            return
        declared = _header(scope, b"content-length")
        if declared and not declared.isdigit():
            # A length we cannot read would skip the check below: refuse it.
            await error_response(
                ErrorCode.VALIDATION_ERROR,
                "Content-Length must be a number.",
                details=[{"loc": ["header", "content-length"], "type": "value_error"}],
            )(scope, receive, send)
            return
        if declared and int(declared) > self.max_bytes:
            await error_response(ErrorCode.REQUEST_TOO_LARGE)(scope, receive, send)
            return
        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Raised inside FastAPI's body read, which passes HTTP errors on unchanged;
                    # the handler turns 413 into REQUEST_TOO_LARGE.
                    raise HTTPException(status_code=413)
            return message

        await self.app(scope, counted, send)
