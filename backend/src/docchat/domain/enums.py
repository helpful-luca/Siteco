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
