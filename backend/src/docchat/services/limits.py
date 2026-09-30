"""Our own limits (annex 11, 6): requests per minute and the optional daily budget.

Both are global, because there is one local workspace. The minute windows live in memory (a
restart resets them, on purpose); the budget reads the usage ledger in SQLite, so it survives.
Anthropic's own 429 is a different thing (`LLM_RATE_LIMITED`, sent as 503).
"""

import math
import threading
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import Clock, MonotonicClock, UsageLedger

WINDOW_S = 60.0


class LimitScope(StrEnum):
    CHAT = "chat"
    UPLOAD = "upload"


class RateLimit:
    """Sliding window: at most `per_minute` requests in any 60 seconds. 0 turns it off."""

    def __init__(self, scope: LimitScope, per_minute: int, clock: MonotonicClock) -> None:
        self.scope = scope
        self.per_minute = per_minute
        self._clock = clock
        self._times: deque[float] = deque()
        # Answers are prepared in worker threads.
        self._lock = threading.Lock()

    def acquire(self, cost: int = 1) -> None:
        """Counts `cost` requests, all or none (a comparison is two answers). Raises
        RATE_LIMITED with the seconds until enough of the window is free."""
        if self.per_minute <= 0:
            return
        with self._lock:
            now = self._clock.monotonic()
            while self._times and self._times[0] <= now - WINDOW_S:
                self._times.popleft()
            over = len(self._times) + cost - self.per_minute
            if over > 0:
                raise self._refusal(now, over)
            self._times.extend([now] * cost)

    def _refusal(self, now: float, over: int) -> AppError:
        if over > len(self._times):  # more than the whole limit at once
            seconds = math.ceil(WINDOW_S)
        else:
            seconds = max(1, math.ceil(self._times[over - 1] + WINDOW_S - now))
        return AppError(
            ErrorCode.RATE_LIMITED,
            f"More than {self.per_minute} {self.scope.value} requests per minute.",
            params={"seconds": seconds, "scope": self.scope.value},
            retry_after=seconds,
        )


@dataclass(frozen=True)
class BudgetStatus:
    limit_usd: float
    spent_usd: float
    exceeded: bool
    reset_at: datetime


def _next_utc_midnight(now: datetime) -> datetime:
    day = now.astimezone(UTC).date() + timedelta(days=1)
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


class DailyBudget:
    """Optional cost brake in USD per UTC day (`DAILY_BUDGET_USD`, off by default, decision
    Luca). The check uses what was spent so far; a running answer may go slightly over."""

    def __init__(self, ledger: UsageLedger, clock: Clock, limit_usd: float | None) -> None:
        self._ledger = ledger
        self._clock = clock
        self.limit_usd = limit_usd

    def status(self) -> BudgetStatus | None:
        if self.limit_usd is None:
            return None
        now = self._clock.now()
        spent = self._ledger.cost_on(now.astimezone(UTC).date().isoformat())
        return BudgetStatus(
            limit_usd=self.limit_usd,
            spent_usd=spent,
            exceeded=spent >= self.limit_usd,
            reset_at=_next_utc_midnight(now),
        )

    def check(self) -> None:
        status = self.status()
        if status is None or not status.exceeded:
            return
        now = self._clock.now()
        raise AppError(
            ErrorCode.TOKEN_BUDGET_EXCEEDED,
            params={"reset_time": status.reset_at.isoformat().replace("+00:00", "Z")},
            retry_after=max(1, math.ceil((status.reset_at - now).total_seconds())),
        )
