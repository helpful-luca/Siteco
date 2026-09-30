"""Functions the isolated worker process can import (spawned processes need importable code)."""

import os
import time


def add(a: int, b: int) -> int:
    return a + b


def sleep_then_return(seconds: float) -> str:
    time.sleep(seconds)
    return "late"


def crash() -> None:
    os._exit(3)


def pid() -> int:
    return os.getpid()


def raise_timeout() -> None:
    raise TimeoutError("socket timed out inside the task")
