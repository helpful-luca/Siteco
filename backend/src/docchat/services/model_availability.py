"""Which enabled models can answer right now.

A model Claude says it does not know (`not_found_error`: a retired model, a typo in the
configuration, missing access) is marked unavailable for a while (annex 10, B15), then tried
again, so a short outage of one model does not last until the next restart. There is no silent
rerouting: questions with it are refused and name a fallback instead.
"""

import threading
from collections.abc import Collection

from docchat.domain.model_profiles import MODEL_PROFILES
from docchat.domain.ports import MonotonicClock

UNAVAILABLE_FOR_S = 600.0


class ModelAvailability:
    def __init__(
        self,
        enabled: Collection[str],
        default: str,
        clock: MonotonicClock,
        unavailable_for_s: float = UNAVAILABLE_FOR_S,
    ) -> None:
        self._enabled = [m for m in MODEL_PROFILES if m in enabled]
        self._default = default
        self._clock = clock
        self._unavailable_for_s = unavailable_for_s
        self._until: dict[str, float] = {}  # model -> monotonic time it may be tried again
        self._lock = threading.Lock()

    def is_available(self, model: str) -> bool:
        with self._lock:
            if model not in self._enabled:
                return False
            until = self._until.get(model)
            if until is not None and self._clock.monotonic() >= until:
                del self._until[model]
                until = None
            return until is None

    def mark_unavailable(self, model: str) -> None:
        with self._lock:
            self._until[model] = self._clock.monotonic() + self._unavailable_for_s

    def fallback(self, model: str) -> str | None:
        """The default model if it can stand in, else the first other available one."""
        candidates = [self._default, *self._enabled]
        return next((m for m in candidates if m != model and self.is_available(m)), None)
