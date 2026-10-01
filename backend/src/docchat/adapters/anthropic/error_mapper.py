"""Claude API failures to our codes, by `error.type` first: errors inside a stream arrive
after HTTP 200, so the status code alone says nothing (annex 10, H12)."""

import re

import anthropic
import httpx2

from docchat.domain.errors import ErrorCode
from docchat.domain.llm import LLMError

_BY_TYPE = {
    "invalid_request_error": ErrorCode.LLM_BAD_REQUEST,
    "authentication_error": ErrorCode.LLM_AUTH,
    "billing_error": ErrorCode.LLM_BILLING,
    "permission_error": ErrorCode.LLM_FORBIDDEN,
    "not_found_error": ErrorCode.MODEL_UNAVAILABLE,
    "request_too_large": ErrorCode.LLM_CONTEXT_TOO_LARGE,
    "rate_limit_error": ErrorCode.LLM_RATE_LIMITED,
    "api_error": ErrorCode.LLM_UNAVAILABLE,
    "overloaded_error": ErrorCode.LLM_OVERLOADED,
    "timeout_error": ErrorCode.LLM_TIMEOUT,
}
_BY_STATUS = {
    400: ErrorCode.LLM_BAD_REQUEST,
    401: ErrorCode.LLM_AUTH,
    402: ErrorCode.LLM_BILLING,
    403: ErrorCode.LLM_FORBIDDEN,
    404: ErrorCode.MODEL_UNAVAILABLE,
    413: ErrorCode.LLM_CONTEXT_TOO_LARGE,
    429: ErrorCode.LLM_RATE_LIMITED,
    529: ErrorCode.LLM_OVERLOADED,
}
_BILLING = re.compile(r"credit balance|spend limit|billing", re.IGNORECASE)
_WORKSPACE = re.compile(r"anthropic-workspace-id|not scoped to a workspace", re.IGNORECASE)
_KEY_LIKE = re.compile(r"sk-ant-[\w-]+")
_DETAIL_CHARS = 300
_TOO_LONG = re.compile(r"prompt is too long|context (window|length)", re.IGNORECASE)
_DEFAULT_RETRY_AFTER = {ErrorCode.LLM_RATE_LIMITED: 30, ErrorCode.LLM_OVERLOADED: 5}


def _retry_after(exc: anthropic.APIStatusError) -> int | None:
    value = exc.response.headers.get("retry-after")
    try:
        return max(0, round(float(value))) if value is not None else None
    except ValueError:
        return None


def _status_code(exc: anthropic.APIStatusError) -> ErrorCode:
    code = _BY_TYPE.get(exc.type or "")
    if code is None:
        code = _BY_STATUS.get(exc.status_code)
    if code is None:
        code = ErrorCode.LLM_UNAVAILABLE if exc.status_code >= 500 else ErrorCode.LLM_BAD_REQUEST
    if code is ErrorCode.LLM_BAD_REQUEST:
        if needs_workspace(exc):
            return ErrorCode.LLM_KEY_NEEDS_WORKSPACE
        if _BILLING.search(exc.message):
            return ErrorCode.LLM_BILLING
        if _TOO_LONG.search(exc.message):
            return ErrorCode.LLM_CONTEXT_TOO_LARGE
    return code


def needs_workspace(exc: anthropic.APIStatusError) -> bool:
    """The key belongs to no workspace, so every request must name one in a header."""
    return exc.type in (None, "invalid_request_error") and bool(_WORKSPACE.search(exc.message))


def error_details(exc: Exception) -> dict[str, str]:
    """Anthropic's error type and a shortened message for the log, never a key. The messages
    describe the request (field names, limits), not the documents or the question."""
    if not isinstance(exc, anthropic.APIStatusError):
        return {"error_type": type(exc).__name__}
    message = _KEY_LIKE.sub("[key]", exc.message)[:_DETAIL_CHARS]
    return {"error_type": exc.type or str(exc.status_code), "error_message": message}


def _request_id(exc: anthropic.APIStatusError) -> str | None:
    if exc.request_id:
        return exc.request_id
    body = exc.body
    value = body.get("request_id") if isinstance(body, dict) else None
    return value if isinstance(value, str) else None


def map_error(exc: Exception) -> LLMError:
    if isinstance(exc, anthropic.APITimeoutError | httpx2.TimeoutException):
        return LLMError(ErrorCode.LLM_TIMEOUT)
    if isinstance(exc, anthropic.APIConnectionError | httpx2.TransportError):
        return LLMError(ErrorCode.LLM_UNREACHABLE)
    if isinstance(exc, anthropic.APIStatusError):
        code = _status_code(exc)
        return LLMError(
            code,
            retry_after=_retry_after(exc) or _DEFAULT_RETRY_AFTER.get(code),
            upstream_request_id=_request_id(exc),
            model_gone=exc.type == "not_found_error",
        )
    return LLMError(ErrorCode.LLM_UNAVAILABLE)
