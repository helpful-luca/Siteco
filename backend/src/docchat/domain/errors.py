"""Stable error codes. The single source of truth for backend and frontend (via OpenAPI)."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    UNAUTHORIZED_CLIENT = "UNAUTHORIZED_CLIENT"
    SERVICE_STARTING = "SERVICE_STARTING"
    INTERNAL_ERROR = "INTERNAL_ERROR"


@dataclass(frozen=True)
class ErrorSpec:
    status: int
    retryable: bool


ERROR_SPECS: dict[ErrorCode, ErrorSpec] = {
    ErrorCode.VALIDATION_ERROR: ErrorSpec(422, False),
    ErrorCode.NOT_FOUND: ErrorSpec(404, False),
    ErrorCode.METHOD_NOT_ALLOWED: ErrorSpec(405, False),
    ErrorCode.UNAUTHORIZED_CLIENT: ErrorSpec(401, False),
    ErrorCode.SERVICE_STARTING: ErrorSpec(503, True),
    ErrorCode.INTERNAL_ERROR: ErrorSpec(500, True),
}


class AppError(Exception):
    """Expected, user-facing failure. Mapped to the error envelope by the API layer."""

    def __init__(
        self,
        code: ErrorCode,
        message: str = "",
        *,
        params: dict[str, Any] | None = None,
        retry_after: int | None = None,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message or code.value)
        self.code = code
        self.message = message or code.value
        self.params: dict[str, Any] = params or {}
        self.retry_after = retry_after
        self.details: list[dict[str, Any]] = details or []

    @property
    def status(self) -> int:
        return ERROR_SPECS[self.code].status

    @property
    def retryable(self) -> bool:
        return ERROR_SPECS[self.code].retryable
