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
    REQUEST_TOO_LARGE = "REQUEST_TOO_LARGE"
    # Our own limits (annex 11, 6): 429 means "wait a moment", never "Claude is busy"
    RATE_LIMITED = "RATE_LIMITED"
    # Upload (synchronous checks in the request)
    UPLOAD_TOO_LARGE = "UPLOAD_TOO_LARGE"
    UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE"
    FILE_CONTENT_MISMATCH = "FILE_CONTENT_MISMATCH"
    EMPTY_FILE = "EMPTY_FILE"
    DUPLICATE_DOCUMENT = "DUPLICATE_DOCUMENT"
    STORAGE_QUOTA = "STORAGE_QUOTA"
    STORAGE_FULL = "STORAGE_FULL"
    UPLOAD_INCOMPLETE = "UPLOAD_INCOMPLETE"
    # Library
    DOCUMENT_NOT_READY = "DOCUMENT_NOT_READY"
    DOCUMENT_FILE_MISSING = "DOCUMENT_FILE_MISSING"
    DELETE_FAILED = "DELETE_FAILED"
    RANGE_NOT_SATISFIABLE = "RANGE_NOT_SATISFIABLE"
    # Quality page: no results file (or one that does not fit the schema)
    # Ingestion (never an HTTP response: stored as documents.error_code with status `failed`)
    PDF_ENCRYPTED = "PDF_ENCRYPTED"
    PDF_CORRUPT = "PDF_CORRUPT"
    PDF_NO_TEXT = "PDF_NO_TEXT"
    PDF_TOO_MANY_PAGES = "PDF_TOO_MANY_PAGES"
    TEXT_ENCODING_UNSUPPORTED = "TEXT_ENCODING_UNSUPPORTED"
    DOCUMENT_EMPTY = "DOCUMENT_EMPTY"
    DOCUMENT_TOO_LONG = "DOCUMENT_TOO_LONG"
    PROCESSING_TIMEOUT = "PROCESSING_TIMEOUT"
    PROCESSING_FAILED = "PROCESSING_FAILED"
    PROCESSING_INTERRUPTED = "PROCESSING_INTERRUPTED"
    # Malware scan (stored like ingestion errors; params carry the signature name)
    MALWARE_DETECTED = "MALWARE_DETECTED"
    MALWARE_SCAN_FAILED = "MALWARE_SCAN_FAILED"
    # Chats and answers (checked before the stream opens, annex 10 S1)
    CHAT_NOT_FOUND = "CHAT_NOT_FOUND"
    CHAT_BUSY = "CHAT_BUSY"
    CHAT_LIMIT = "CHAT_LIMIT"
    MESSAGE_LIMIT = "MESSAGE_LIMIT"
    MESSAGE_NOT_LATEST = "MESSAGE_NOT_LATEST"
    DUPLICATE_REQUEST = "DUPLICATE_REQUEST"
    CONCURRENCY_LIMIT = "CONCURRENCY_LIMIT"
    NO_DOCUMENTS = "NO_DOCUMENTS"
    DOCUMENTS_NOT_READY = "DOCUMENTS_NOT_READY"
    QUESTION_EMPTY = "QUESTION_EMPTY"
    QUESTION_TOO_LONG = "QUESTION_TOO_LONG"
    MODEL_NOT_ALLOWED = "MODEL_NOT_ALLOWED"
    COMPARE_SAME_MODEL = "COMPARE_SAME_MODEL"
    TOKEN_BUDGET_EXCEEDED = "TOKEN_BUDGET_EXCEEDED"
    # Claude API, mapped by `error.type` (mid-stream errors arrive with HTTP 200)
    LLM_AUTH = "LLM_AUTH"
    API_KEY_INVALID = "API_KEY_INVALID"
    LLM_BILLING = "LLM_BILLING"
    LLM_FORBIDDEN = "LLM_FORBIDDEN"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    LLM_RATE_LIMITED = "LLM_RATE_LIMITED"
    LLM_OVERLOADED = "LLM_OVERLOADED"
    LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    LLM_UNREACHABLE = "LLM_UNREACHABLE"
    LLM_BAD_REQUEST = "LLM_BAD_REQUEST"
    LLM_CONTEXT_TOO_LARGE = "LLM_CONTEXT_TOO_LARGE"
    LLM_EMPTY_ANSWER = "LLM_EMPTY_ANSWER"


class NoticeCode(StrEnum):
    """Hints that are not errors. The UI translates them via `notices.<CODE>`."""

    PAGES_WITHOUT_TEXT = "PAGES_WITHOUT_TEXT"
    PAGES_OCR = "PAGES_OCR"
    OCR_RUNNING = "OCR_RUNNING"  # while parsing: a scanned page is being recognized
    PAGES_SKIPPED = "PAGES_SKIPPED"
    PDF_ACTIVE_CONTENT = "PDF_ACTIVE_CONTENT"
    SCANNER_STARTING = "SCANNER_STARTING"
    SCANNER_UNAVAILABLE = "SCANNER_UNAVAILABLE"
    # Answers
    SOURCES_PARTIAL = "SOURCES_PARTIAL"
    SUMMARY_PARTIAL = "SUMMARY_PARTIAL"
    NO_CITATIONS = "NO_CITATIONS"
    ANSWER_TRUNCATED = "ANSWER_TRUNCATED"
    LLM_REFUSED = "LLM_REFUSED"
    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    MODEL_SWITCHED = "MODEL_SWITCHED"
    # Viewer: the exact sentence cannot be marked on this page (annex 10, L4)
    HIGHLIGHT_UNAVAILABLE = "HIGHLIGHT_UNAVAILABLE"


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
    ErrorCode.REQUEST_TOO_LARGE: ErrorSpec(413, False),
    ErrorCode.RATE_LIMITED: ErrorSpec(429, True),
    ErrorCode.UPLOAD_TOO_LARGE: ErrorSpec(413, False),
    ErrorCode.UNSUPPORTED_TYPE: ErrorSpec(415, False),
    ErrorCode.FILE_CONTENT_MISMATCH: ErrorSpec(415, False),
    ErrorCode.EMPTY_FILE: ErrorSpec(422, False),
    ErrorCode.DUPLICATE_DOCUMENT: ErrorSpec(409, False),
    ErrorCode.STORAGE_QUOTA: ErrorSpec(409, False),
    ErrorCode.STORAGE_FULL: ErrorSpec(507, False),
    ErrorCode.UPLOAD_INCOMPLETE: ErrorSpec(400, True),
    ErrorCode.DOCUMENT_NOT_READY: ErrorSpec(409, True),
    ErrorCode.DOCUMENT_FILE_MISSING: ErrorSpec(410, False),
    ErrorCode.DELETE_FAILED: ErrorSpec(500, True),
    ErrorCode.RANGE_NOT_SATISFIABLE: ErrorSpec(416, False),
    ErrorCode.PDF_ENCRYPTED: ErrorSpec(422, False),
    ErrorCode.PDF_CORRUPT: ErrorSpec(422, False),
    ErrorCode.PDF_NO_TEXT: ErrorSpec(422, False),
    ErrorCode.PDF_TOO_MANY_PAGES: ErrorSpec(422, False),
    ErrorCode.TEXT_ENCODING_UNSUPPORTED: ErrorSpec(422, False),
    ErrorCode.DOCUMENT_EMPTY: ErrorSpec(422, False),
    ErrorCode.DOCUMENT_TOO_LONG: ErrorSpec(422, False),
    ErrorCode.PROCESSING_TIMEOUT: ErrorSpec(500, True),
    ErrorCode.PROCESSING_FAILED: ErrorSpec(500, True),
    ErrorCode.PROCESSING_INTERRUPTED: ErrorSpec(500, True),
    ErrorCode.MALWARE_DETECTED: ErrorSpec(422, False),
    ErrorCode.MALWARE_SCAN_FAILED: ErrorSpec(422, True),
    ErrorCode.CHAT_NOT_FOUND: ErrorSpec(404, False),
    ErrorCode.CHAT_BUSY: ErrorSpec(409, True),
    ErrorCode.CHAT_LIMIT: ErrorSpec(409, False),
    ErrorCode.MESSAGE_LIMIT: ErrorSpec(409, False),
    ErrorCode.MESSAGE_NOT_LATEST: ErrorSpec(409, False),
    ErrorCode.DUPLICATE_REQUEST: ErrorSpec(409, False),
    ErrorCode.CONCURRENCY_LIMIT: ErrorSpec(429, True),
    ErrorCode.NO_DOCUMENTS: ErrorSpec(409, False),
    ErrorCode.DOCUMENTS_NOT_READY: ErrorSpec(409, True),
    ErrorCode.QUESTION_EMPTY: ErrorSpec(422, False),
    ErrorCode.QUESTION_TOO_LONG: ErrorSpec(422, False),
    ErrorCode.MODEL_NOT_ALLOWED: ErrorSpec(422, False),
    ErrorCode.COMPARE_SAME_MODEL: ErrorSpec(422, False),
    ErrorCode.TOKEN_BUDGET_EXCEEDED: ErrorSpec(429, True),
    # Anthropic errors are 5xx before the stream opens: our own 429 means "you", not "Claude".
    ErrorCode.LLM_AUTH: ErrorSpec(503, False),
    ErrorCode.API_KEY_INVALID: ErrorSpec(422, False),
    ErrorCode.LLM_BILLING: ErrorSpec(503, False),
    ErrorCode.LLM_FORBIDDEN: ErrorSpec(503, False),
    ErrorCode.MODEL_UNAVAILABLE: ErrorSpec(503, False),
    ErrorCode.LLM_RATE_LIMITED: ErrorSpec(503, True),
    ErrorCode.LLM_OVERLOADED: ErrorSpec(503, True),
    ErrorCode.LLM_UNAVAILABLE: ErrorSpec(502, True),
    ErrorCode.LLM_TIMEOUT: ErrorSpec(504, True),
    ErrorCode.LLM_UNREACHABLE: ErrorSpec(502, True),
    ErrorCode.LLM_BAD_REQUEST: ErrorSpec(500, False),
    ErrorCode.LLM_CONTEXT_TOO_LARGE: ErrorSpec(500, False),
    ErrorCode.LLM_EMPTY_ANSWER: ErrorSpec(502, True),
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


class IngestionError(Exception):
    """A document cannot be ingested. Picklable, so the parser process can raise it too."""

    def __init__(self, code: ErrorCode) -> None:
        super().__init__(code)
        self.code = code
