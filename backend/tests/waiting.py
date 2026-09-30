"""Waiting for background work without betting on how fast the machine is."""

import asyncio
from collections.abc import Callable

PATIENCE_S = 10.0


async def eventually(condition: Callable[[], bool], timeout_s: float = PATIENCE_S) -> None:
    """Polls until `condition` holds. The limit only catches a hang; a slow machine just waits."""
    async with asyncio.timeout(timeout_s):
        while not condition():
            await asyncio.sleep(0.01)
