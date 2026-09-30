import os

import pytest

from docchat.adapters.process_runner import IsolatedProcess, ProcessCrashed, ProcessTimeout
from tests import process_helpers


async def test_runs_function_in_another_process() -> None:
    runner = IsolatedProcess()
    try:
        assert await runner.run(30, process_helpers.add, 2, 3) == 5
        assert await runner.run(30, process_helpers.pid) != os.getpid()
    finally:
        await runner.close()


async def test_timeout_kills_the_process_and_the_next_call_gets_a_fresh_one() -> None:
    runner = IsolatedProcess()
    try:
        first = await runner.run(30, process_helpers.pid)
        with pytest.raises(ProcessTimeout):
            await runner.run(0.5, process_helpers.sleep_then_return, 30)
        second = await runner.run(30, process_helpers.pid)
        assert second != first
    finally:
        await runner.close()


async def test_crash_is_reported_and_recovered() -> None:
    runner = IsolatedProcess()
    try:
        with pytest.raises(ProcessCrashed):
            await runner.run(30, process_helpers.crash)
        assert await runner.run(30, process_helpers.add, 1, 1) == 2
    finally:
        await runner.close()
