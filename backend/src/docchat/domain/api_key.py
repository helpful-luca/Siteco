"""The Claude API key as the app manages it: where it comes from, what is shown of it."""

import re
from dataclasses import dataclass
from enum import StrEnum

from docchat.domain.enums import LlmStatus

# Anthropic keys are long ASCII tokens without spaces. Anything else is a typo or a paste of
# the wrong thing, refused before a request is sent.
_KEY = re.compile(r"[\x21-\x7e]{20,512}")
# Workspace ids look like "wrkspc_01AbC..."; letters, digits, "_" and "-" only.
_WORKSPACE_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
SUFFIX_CHARS = 4


class KeySource(StrEnum):
    SETTINGS = "settings"  # entered in the app; wins over the environment
    ENV = "env"  # ANTHROPIC_API_KEY


class KeyCheck(StrEnum):
    """Result of the free test call made before a key is saved."""

    VALID = "valid"
    INVALID = "invalid"  # Anthropic refused it (401, 403)
    NEEDS_WORKSPACE = "needs_workspace"  # valid, but every call needs a workspace id
    UNREACHABLE = "unreachable"  # no answer (offline, timeout, overloaded): checked later


@dataclass(frozen=True)
class KeyState:
    """What the UI may know. Never the key itself, only its last characters."""

    configured: bool
    source: KeySource | None
    suffix: str | None
    status: LlmStatus
    workspace_id: str | None = None  # not a secret: sent as `anthropic-workspace-id`


def clean_key(raw: str) -> str | None:
    """The key without surrounding whitespace, or None when it cannot be a key."""
    key = raw.strip()
    return key if _KEY.fullmatch(key) else None


def clean_workspace_id(raw: str | None) -> str | None:
    """The workspace id without whitespace; None when empty. Raises ValueError when it
    cannot be one (it goes into an HTTP header)."""
    value = (raw or "").strip()
    if not value:
        return None
    if not _WORKSPACE_ID.fullmatch(value):
        raise ValueError("not a workspace id")
    return value


def key_suffix(key: str) -> str:
    return key[-SUFFIX_CHARS:]
