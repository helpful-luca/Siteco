"""MalwareScanner over clamd's INSTREAM command (TCP), see clamd(8).

Implemented here because the PyPI clients (`clamd`, `pyclamd`) are unmaintained and block the
event loop, and the protocol is small.
"""

import asyncio
import contextlib
import os
import struct
from pathlib import Path
from typing import BinaryIO

from docchat.domain.malware import ScanFailed, ScannerUnavailable, ScanVerdict

_END_OF_STREAM = struct.pack(">I", 0)
_MAX_SIGNATURE = 120


def parse_reply(reply: bytes) -> ScanVerdict:
    text = reply.rstrip(b"\0").decode("utf-8", "replace").strip()
    if text == "stream: OK":
        return ScanVerdict()
    if text.startswith("stream: ") and text.endswith(" FOUND"):
        name = text[len("stream: ") : -len(" FOUND")]
        return ScanVerdict("".join(c for c in name if c.isprintable())[:_MAX_SIGNATURE])
    raise ScanFailed(text[:200])


class ClamdScanner:
    def __init__(
        self,
        host: str,
        port: int,
        *,
        connect_timeout_s: float = 3.0,
        scan_timeout_s: float = 300.0,
        chunk_size: int = 1024 * 1024,
        max_stream_bytes: int | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._connect_timeout_s = connect_timeout_s
        self._scan_timeout_s = scan_timeout_s
        self._chunk_size = chunk_size
        # clamd's StreamMaxLength (set in compose.yaml). Larger files are refused up front,
        # because clamd would drop the connection halfway, which looks like an outage.
        self._max_stream_bytes = max_stream_bytes

    async def scan(self, path: Path) -> ScanVerdict:
        # Opened before connecting: a missing file is the caller's problem, not clamd's.
        with path.open("rb") as file:
            size = os.fstat(file.fileno()).st_size
            if self._max_stream_bytes is not None and size > self._max_stream_bytes:
                raise ScanFailed("file is larger than the scanner's stream limit")
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self._host, self._port), self._connect_timeout_s
                )
            except (OSError, TimeoutError) as exc:
                raise ScannerUnavailable(str(exc)) from exc
            try:
                async with asyncio.timeout(self._scan_timeout_s):
                    return await self._exchange(file, reader, writer)
            except TimeoutError as exc:
                raise ScannerUnavailable("clamd did not answer in time") from exc
            finally:
                writer.close()
                with contextlib.suppress(OSError):
                    await writer.wait_closed()

    async def _exchange(
        self, file: BinaryIO, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> ScanVerdict:
        # Read while sending: clamd answers early and hangs up when it refuses a stream (size
        # limit), and that answer must not get lost in the connection reset.
        answer = asyncio.create_task(self._read_reply(reader))
        try:
            with contextlib.suppress(ConnectionError):
                await self._send(file, writer, answer)
            reply = await answer
        finally:
            answer.cancel()
        if reply is None:
            raise ScannerUnavailable("clamd closed the connection without an answer")
        return parse_reply(reply)

    async def _send(
        self, file: BinaryIO, writer: asyncio.StreamWriter, answer: asyncio.Task[bytes | None]
    ) -> None:
        writer.write(b"zINSTREAM\0")
        while not answer.done() and (chunk := await asyncio.to_thread(file.read, self._chunk_size)):
            writer.write(struct.pack(">I", len(chunk)) + chunk)
            await writer.drain()
        writer.write(_END_OF_STREAM)
        await writer.drain()

    @staticmethod
    async def _read_reply(reader: asyncio.StreamReader) -> bytes | None:
        try:
            return await reader.readuntil(b"\0")
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
            return None
