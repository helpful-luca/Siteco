from enum import StrEnum


class ComponentStatus(StrEnum):
    LOADING = "loading"
    OK = "ok"
    FAILED = "failed"


class LlmStatus(StrEnum):
    MISSING_KEY = "missing_key"
    UNCHECKED = "unchecked"
    OK = "ok"
    INVALID_KEY = "invalid_key"


class DocumentKind(StrEnum):
    PDF = "pdf"
    TXT = "txt"
    MD = "md"


class DocumentStatus(StrEnum):
    """`scanning` belongs to the malware check (WP-B). `deleting` hides a row until it is gone."""

    SCANNING = "scanning"
    QUEUED = "queued"
    PARSING = "parsing"
    EMBEDDING = "embedding"
    READY = "ready"
    FAILED = "failed"
    DELETING = "deleting"
