"""Running answers by (chat, lane): one per lane, a few in total, and a way to stop them."""

import asyncio
import threading
from enum import StrEnum

from docchat.domain.enums import Lane
from docchat.domain.errors import AppError, ErrorCode

CONCURRENCY_RETRY_AFTER_S = 5


class StopReason(StrEnum):
    STOPPED = "stopped"  # the user pressed stop
    INTERRUPTED = "interrupted"  # the client went away (reload, closed tab, chat deleted)


class RunControl:
    """Handle of one running answer. Stopping cancels its task exactly once."""

    def __init__(self, chat_id: str, lane: Lane) -> None:
        self.chat_id = chat_id
        self.lane = lane
        self.task: asyncio.Task[None] | None = None
        self.stop_reason: StopReason | None = None
        self.started = False  # the task began running (a task cancelled earlier never runs)
        self.finalizing = False  # the answer is being saved; too late to stop it

    def request_stop(self, reason: StopReason) -> bool:
        if self.stop_reason is not None or self.finalizing or self.task is None:
            return False
        self.stop_reason = reason
        if self.started:
            self.task.cancel()
        # Not started yet: the task sees `stop_reason` as its first step and ends at once.
        return True


class RunRegistry:
    def __init__(self, max_concurrent: int) -> None:
        self._max = max_concurrent
        self._runs: dict[tuple[str, Lane], RunControl] = {}
        # Answers are prepared in worker threads; reservations must not race.
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        return len(self._runs)

    def reserve(self, chat_id: str, lane: Lane) -> RunControl:
        with self._lock:
            if (chat_id, lane) in self._runs:
                raise AppError(ErrorCode.CHAT_BUSY)
            if len(self._runs) >= self._max:
                raise AppError(
                    ErrorCode.CONCURRENCY_LIMIT,
                    params={"max": self._max},
                    retry_after=CONCURRENCY_RETRY_AFTER_S,
                )
            control = RunControl(chat_id, lane)
            self._runs[(chat_id, lane)] = control
            return control

    def release(self, control: RunControl) -> None:
        with self._lock:
            if self._runs.get((control.chat_id, control.lane)) is control:
                del self._runs[(control.chat_id, control.lane)]

    def _controls(self, chat_id: str, lane: Lane | None) -> list[RunControl]:
        with self._lock:
            return [
                c
                for (cid, run_lane), c in self._runs.items()
                if cid == chat_id and lane in (None, run_lane)
            ]

    def stop(self, chat_id: str, lane: Lane | None = None) -> list[Lane]:
        """Stops the chat's answers (all lanes without `lane`). Returns the stopped lanes."""
        return sorted(
            c.lane for c in self._controls(chat_id, lane) if c.request_stop(StopReason.STOPPED)
        )

    async def stop_and_wait(self, chat_id: str) -> None:
        """Before deleting a chat: stop its answers and wait until they saved what they had."""
        controls = self._controls(chat_id, None)
        for control in controls:
            control.request_stop(StopReason.INTERRUPTED)
        tasks = [c.task for c in controls if c.task is not None]
        if tasks:
            await asyncio.wait(tasks)
