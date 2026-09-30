"""Runs a function in one separate worker process, with a timeout that really stops it.

A thread cannot be stopped, so a PDF that hangs pdfium would block ingestion forever. On timeout
or crash the worker process is killed and a fresh one starts with the next call. Python 3.12 has no
public API to kill a ProcessPoolExecutor's workers (3.14 adds kill_workers), hence `_processes`.
"""

import asyncio
import functools
import multiprocessing
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


class ProcessTimeout(Exception):
    pass


class ProcessCrashed(Exception):
    pass


class IsolatedProcess:
    def __init__(self, *, max_tasks_per_child: int | None = None) -> None:
        self._max_tasks_per_child = max_tasks_per_child
        self._pool: ProcessPoolExecutor | None = None
        self._lock = asyncio.Lock()

    def _ensure_pool(self) -> ProcessPoolExecutor:
        if self._pool is None:
            # spawn, not fork: the parent runs threads (onnxruntime, LanceDB) that fork would copy.
            self._pool = ProcessPoolExecutor(
                max_workers=1,
                mp_context=multiprocessing.get_context("spawn"),
                max_tasks_per_child=self._max_tasks_per_child,
            )
        return self._pool

    def _kill(self) -> None:
        pool, self._pool = self._pool, None
        if pool is None:
            return
        for process in list(getattr(pool, "_processes", {}).values()):
            process.kill()
        pool.shutdown(wait=False, cancel_futures=True)

    async def run(self, timeout: float, fn: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
        async with self._lock:
            pool = self._ensure_pool()
            loop = asyncio.get_running_loop()
            future = loop.run_in_executor(pool, functools.partial(fn, *args, **kwargs))
            # asyncio.wait, not wait_for: a TimeoutError raised by fn itself must not look like
            # a hang, so "not done in time" is checked separately from the task's own result.
            done, _ = await asyncio.wait({future}, timeout=timeout)
            if not done:
                future.cancel()
                self._kill()
                raise ProcessTimeout
            try:
                return future.result()
            except BrokenProcessPool as exc:
                self._kill()
                raise ProcessCrashed from exc

    async def close(self) -> None:
        """Stops the worker process at once, even in the middle of a task."""
        async with self._lock:
            self._kill()
