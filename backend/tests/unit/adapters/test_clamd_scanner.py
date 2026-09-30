"""ClamdScanner against a tiny fake clamd that speaks the INSTREAM protocol."""

import asyncio
import socket
import struct
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from docchat.adapters.clamd_scanner import ClamdScanner, parse_reply
from docchat.domain.malware import ScanFailed, ScannerUnavailable, ScanVerdict

Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def read_instream(reader: asyncio.StreamReader) -> bytes:
    assert await reader.readuntil(b"\0") == b"zINSTREAM\0"
    data = b""
    while True:
        (size,) = struct.unpack(">I", await reader.readexactly(4))
        if size == 0:
            return data
        data += await reader.readexactly(size)


def replying(reply: bytes, received: list[bytes] | None = None) -> Handler:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        data = await read_instream(reader)
        if received is not None:
            received.append(data)
        writer.write(reply)
        await writer.drain()
        writer.close()

    return handle


@asynccontextmanager
async def fake_clamd(handler: Handler) -> AsyncIterator[int]:
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        yield port
    finally:
        server.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


@pytest.fixture
def sample(tmp_path: Path) -> Path:
    path = tmp_path / "sample.txt"
    path.write_bytes(b"Die Leuchte hat 5000 Lumen. " * 10)
    return path


def test_reply_parsing() -> None:
    assert parse_reply(b"stream: OK\0") == ScanVerdict()
    assert parse_reply(b"stream: Win.Test.EICAR_HDB-1 FOUND\0") == ScanVerdict(
        "Win.Test.EICAR_HDB-1"
    )
    with pytest.raises(ScanFailed):
        parse_reply(b"INSTREAM size limit exceeded. ERROR\0")
    with pytest.raises(ScanFailed):
        parse_reply(b"something unexpected\0")


def test_signature_names_are_cleaned_and_capped() -> None:
    verdict = parse_reply(b"stream: Bad\x07Name" + b"x" * 300 + b" FOUND\0")
    assert verdict.signature is not None
    assert verdict.signature.startswith("BadName")
    assert len(verdict.signature) == 120


async def test_streams_the_file_in_frames_and_reports_clean(sample: Path) -> None:
    received: list[bytes] = []
    async with fake_clamd(replying(b"stream: OK\0", received)) as port:
        verdict = await ClamdScanner("127.0.0.1", port, chunk_size=7).scan(sample)
    assert verdict == ScanVerdict()
    assert received == [sample.read_bytes()]


async def test_reports_the_signature_of_an_infected_file(sample: Path) -> None:
    async with fake_clamd(replying(b"stream: Eicar-Test-Signature FOUND\0")) as port:
        verdict = await ClamdScanner("127.0.0.1", port).scan(sample)
    assert verdict.infected
    assert verdict.signature == "Eicar-Test-Signature"


async def test_unreachable_scanner_means_try_later(sample: Path) -> None:
    with pytest.raises(ScannerUnavailable):
        await ClamdScanner("127.0.0.1", free_port()).scan(sample)


async def test_a_scanner_that_hangs_times_out(sample: Path) -> None:
    async def hang(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await read_instream(reader)
        await asyncio.sleep(5)

    async with fake_clamd(hang) as port:
        with pytest.raises(ScannerUnavailable):
            await ClamdScanner("127.0.0.1", port, scan_timeout_s=0.2).scan(sample)


async def test_a_scanner_that_closes_without_answer_means_try_later(sample: Path) -> None:
    async def close(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await read_instream(reader)
        writer.close()

    async with fake_clamd(close) as port:
        with pytest.raises(ScannerUnavailable):
            await ClamdScanner("127.0.0.1", port).scan(sample)


async def test_size_limit_answer_mid_stream_is_a_scan_failure(tmp_path: Path) -> None:
    big = tmp_path / "big.txt"
    big.write_bytes(b"x" * 4_000_000)

    async def refuse(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.readuntil(b"\0")
        await reader.readexactly(4)
        writer.write(b"INSTREAM size limit exceeded. ERROR\0")
        await writer.drain()
        writer.close()

    async with fake_clamd(refuse) as port:
        with pytest.raises(ScanFailed):
            await ClamdScanner("127.0.0.1", port, chunk_size=65536).scan(big)


async def test_files_above_the_stream_limit_are_refused_up_front(sample: Path) -> None:
    with pytest.raises(ScanFailed):
        await ClamdScanner("127.0.0.1", free_port(), max_stream_bytes=10).scan(sample)
