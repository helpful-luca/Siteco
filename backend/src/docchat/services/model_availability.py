"""Which enabled models can answer right now.

A model that Claude does not know (404 `not_found_error`: a retired model, a typo in the
configuration, missing access) is marked unavailable until the next restart (annex 10, B15).
There is no silent rerouting: questions with it are refused and name a fallback instead.
"""

import threading
from collections.abc import Collection

from docchat.domain.model_profiles import MODEL_PROFILES


class ModelAvailability:
    def __init__(self, enabled: Collection[str], default: str) -> None:
        self._enabled = [m for m in MODEL_PROFILES if m in enabled]
        self._default = default
        self._unavailable: set[str] = set()
        self._lock = threading.Lock()

    def is_available(self, model: str) -> bool:
        with self._lock:
            return model in self._enabled and model not in self._unavailable

    def mark_unavailable(self, model: str) -> None:
        with self._lock:
            self._unavailable.add(model)

    def fallback(self, model: str) -> str | None:
        """The default model if it can stand in, else the first other available one."""
        candidates = [self._default, *self._enabled]
        return next((m for m in candidates if m != model and self.is_available(m)), None)
