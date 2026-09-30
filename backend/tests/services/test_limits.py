"""Own rate limits and the optional daily budget (annex 11, 6) with a clock the tests move."""

import threading
from datetime import UTC, datetime, timedelta

import pytest

from docchat.domain.errors import AppError, ErrorCode
from docchat.services.limits import DailyBudget, LimitScope, RateLimit
from tests.fakes import FakeTicker


class LedgerStub:
    def __init__(self, cost: float = 0.0) -> None:
        self.cost = cost
        self.days: list[str] = []

    def cost_on(self, day: str) -> float:
        self.days.append(day)
        return self.cost


class ClockStub:
    def __init__(self, now: datetime) -> None:
        self.current = now

    def now(self) -> datetime:
        return self.current


def refused(limit: RateLimit, cost: int = 1) -> AppError:
    with pytest.raises(AppError) as caught:
        limit.acquire(cost)
    return caught.value


def test_allows_up_to_the_limit_within_a_minute() -> None:
    ticker = FakeTicker()
    limit = RateLimit(LimitScope.CHAT, per_minute=3, clock=ticker)
    for _ in range(3):
        limit.acquire()
        ticker.advance(1)
    error = refused(limit)
    assert error.code is ErrorCode.RATE_LIMITED
    assert error.status == 429 and error.retryable is True


def test_retry_after_counts_down_to_when_the_oldest_request_leaves_the_window() -> None:
    ticker = FakeTicker()
    limit = RateLimit(LimitScope.CHAT, per_minute=2, clock=ticker)
    limit.acquire()  # t = 0
    ticker.advance(20)
    limit.acquire()  # t = 20
    ticker.advance(17)  # t = 37: the first request leaves the window at t = 60
    error = refused(limit)
    assert error.retry_after == 23
    assert error.params == {"seconds": 23, "scope": "chat"}


def test_the_window_slides() -> None:
    ticker = FakeTicker()
    limit = RateLimit(LimitScope.UPLOAD, per_minute=1, clock=ticker)
    limit.acquire()
    ticker.advance(59.5)
    assert refused(limit).retry_after == 1  # rounded up, never 0
    ticker.advance(0.5)
    limit.acquire()


def test_a_refused_request_does_not_use_up_the_limit() -> None:
    ticker = FakeTicker()
    limit = RateLimit(LimitScope.CHAT, per_minute=1, clock=ticker)
    limit.acquire()
    for _ in range(5):
        refused(limit)
    ticker.advance(60)
    limit.acquire()


def test_cost_counts_several_requests_at_once_and_all_or_nothing() -> None:
    ticker = FakeTicker()
    limit = RateLimit(LimitScope.CHAT, per_minute=3, clock=ticker)
    limit.acquire()
    ticker.advance(10)
    limit.acquire(cost=2)  # a comparison: two answers
    ticker.advance(10)
    # Two free slots only once the first request and one of the pair have left the window.
    assert refused(limit, cost=2).retry_after == 50
    assert refused(limit).retry_after == 40
    ticker.advance(40)
    limit.acquire()
    assert refused(limit).retry_after == 10


def test_cost_above_the_limit_waits_a_full_window() -> None:
    limit = RateLimit(LimitScope.CHAT, per_minute=1, clock=FakeTicker())
    assert refused(limit, cost=2).retry_after == 60


def test_zero_turns_the_limit_off() -> None:
    limit = RateLimit(LimitScope.UPLOAD, per_minute=0, clock=FakeTicker())
    for _ in range(1000):
        limit.acquire()


def test_threads_never_get_more_than_the_limit() -> None:
    limit = RateLimit(LimitScope.CHAT, per_minute=50, clock=FakeTicker())
    granted: list[bool] = []
    lock = threading.Lock()

    def worker() -> None:
        for _ in range(20):
            try:
                limit.acquire()
                ok = True
            except AppError:
                ok = False
            with lock:
                granted.append(ok)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert granted.count(True) == 50


def test_budget_off_by_default() -> None:
    ledger = LedgerStub(cost=1000)
    budget = DailyBudget(ledger, ClockStub(datetime(2026, 9, 30, 12, tzinfo=UTC)), limit_usd=None)
    budget.check()
    assert budget.status() is None
    assert ledger.days == []


def test_budget_refuses_until_utc_midnight() -> None:
    now = datetime(2026, 9, 30, 23, 0, 30, tzinfo=UTC)
    ledger = LedgerStub(cost=5.0)
    budget = DailyBudget(ledger, ClockStub(now), limit_usd=5.0)
    with pytest.raises(AppError) as caught:
        budget.check()
    error = caught.value
    assert error.code is ErrorCode.TOKEN_BUDGET_EXCEEDED
    assert error.params == {"reset_time": "2026-10-01T00:00:00Z"}
    assert error.retry_after == 3570
    assert ledger.days == ["2026-09-30"]
    status = budget.status()
    assert status is not None
    assert (status.limit_usd, status.spent_usd, status.exceeded) == (5.0, 5.0, True)
    assert status.reset_at == now.replace(hour=0, minute=0, second=0) + timedelta(days=1)


def test_budget_below_the_limit_passes() -> None:
    budget = DailyBudget(
        LedgerStub(cost=4.99), ClockStub(datetime(2026, 9, 30, tzinfo=UTC)), limit_usd=5.0
    )
    budget.check()
    status = budget.status()
    assert status is not None and status.exceeded is False
