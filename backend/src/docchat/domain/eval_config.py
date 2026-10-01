"""Which retrieval settings an eval result belongs to. A different hash marks the results on the
Quality page as stale (annex 10, N3)."""

import hashlib
import json
from collections.abc import Mapping


def config_hash(fingerprint: Mapping[str, str | int | float | None]) -> str:
    """Stable over key order and processes: sorted JSON, SHA-256, first 16 hex digits."""
    text = json.dumps(dict(fingerprint), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
