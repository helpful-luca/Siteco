from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from docchat.core.logging import request_id_var
from docchat.domain.errors import ERROR_SPECS, ErrorCode


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: ErrorCode
    message: str = Field(description="Developer-facing text for logs. The UI translates `code`.")
    retryable: bool
    retry_after: int | None = None
    request_id: str
    params: dict[str, Any] = Field(default_factory=dict)
    details: list[dict[str, Any]] = Field(default_factory=list)


class ErrorEnvelope(BaseModel):
    error: ErrorBody


def error_response(
    code: ErrorCode,
    message: str = "",
    *,
    params: dict[str, Any] | None = None,
    retry_after: int | None = None,
    details: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    spec = ERROR_SPECS[code]
    envelope = ErrorEnvelope(
        error=ErrorBody(
            code=code,
            message=message or code.value,
            retryable=spec.retryable,
            retry_after=retry_after,
            request_id=request_id_var.get(),
            params=params or {},
            details=details or [],
        )
    )
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse(envelope.model_dump(mode="json"), status_code=spec.status, headers=headers)
