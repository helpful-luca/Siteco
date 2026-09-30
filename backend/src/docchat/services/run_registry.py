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
        if self.stop_reason is not None or self.finalizing:
            return False
        self.stop_reason = reason
        if self.started and self.task is not None:
            self.task.cancel()
        # Still being prepared or not started yet: the task sees `stop_reason` as its first
        # step and ends at once.
        return True


class RunRegistry:
    def __init__(self, max_concurrent: int) -> None:
        self._max = max_concurrent
        self._runs: dict[tuple[str, Lane], RunControl] = {}
        # Chats being deleted automatically: no answer may start in them meanwhile.
        self._closed: set[str] = set()
        # Answers are prepared in worker threads; reservations must not race.
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        return len(self._runs)

    def reserve(self, chat_id: str, lane: Lane) -> RunControl:
        with self._lock:
            if chat_id in self._closed:
                raise AppError(ErrorCode.CHAT_NOT_FOUND)
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

    def is_active(self, chat_id: str) -> bool:
        return bool(self._controls(chat_id, None))

    def close_if_idle(self, chat_id: str) -> bool:
        """Blocks new answers in an idle chat, atomically with the check. False if one runs."""
        with self._lock:
            if any(cid == chat_id for cid, _ in self._runs):
                return False
            self._closed.add(chat_id)
            return True

    def reopen(self, chat_id: str) -> None:
        with self._lock:
            self._closed.discard(chat_id)

    async def stop_all_and_wait(self, timeout_s: float = 30) -> None:
        """Before deleting everything: like stop_and_wait for every chat at once."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        while True:
            with self._lock:
                controls = list(self._runs.values())
            if not controls:
                return
            for control in controls:
                control.request_stop(StopReason.INTERRUPTED)
            if loop.time() > deadline:
                return
            await asyncio.sleep(0.01)

    async def stop_and_wait(self, chat_id: str, timeout_s: float = 30) -> None:
        """Before deleting a chat: stop its answers and wait until they are released, including
        answers still being prepared (reserved, no task yet), so none writes into the chat
        after it is gone."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        while controls := self._controls(chat_id, None):
            for control in controls:
                control.request_stop(StopReason.INTERRUPTED)
            if loop.time() > deadline:
                return
            await asyncio.sleep(0.01)
