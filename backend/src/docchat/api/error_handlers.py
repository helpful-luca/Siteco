"""Every failure leaves the API as the same envelope. Stack traces only go to the log."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from docchat.api.schemas.common import error_response
from docchat.domain.errors import AppError, ErrorCode

log = logging.getLogger("docchat.errors")

_HTTP_TO_CODE = {404: ErrorCode.NOT_FOUND, 405: ErrorCode.METHOD_NOT_ALLOWED}


async def _app_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    return error_response(
        exc.code, exc.message, params=exc.params, retry_after=exc.retry_after, details=exc.details
    )


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    details = [
        {"loc": list(e.get("loc", [])), "type": e.get("type"), "msg": e.get("msg")}
        for e in exc.errors()
    ]
    return error_response(ErrorCode.VALIDATION_ERROR, "Request validation failed.", details=details)


async def _http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    return error_response(_HTTP_TO_CODE.get(exc.status_code, ErrorCode.VALIDATION_ERROR))


async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_exception", exc_info=exc)
    return error_response(ErrorCode.INTERNAL_ERROR, "Unexpected server error.")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(Exception, _unhandled)
