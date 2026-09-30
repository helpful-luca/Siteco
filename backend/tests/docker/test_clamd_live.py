"""ClamdScanner against the real clamd image from compose.yaml. Needs Docker: RUN_DOCKER=1."""

import asyncio
import re
import shutil
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from docchat.adapters.clamd_scanner import ClamdScanner
from docchat.domain.malware import ScannerUnavailable
from tests.eicar import eicar

pytestmark = pytest.mark.docker

COMPOSE = Path(__file__).resolve().parents[3] / "compose.yaml"
DOCKER = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"


def _image() -> str:
    match = re.search(r"image:\s*(clamav/clamav:\S+)", COMPOSE.read_text("utf-8"))
    assert match, "compose.yaml has no clamav image"
    return match.group(1)


@pytest.fixture(scope="module")
def clamd_port() -> Iterator[int]:
    container = subprocess.run(
        [
            DOCKER,
            "run",
            "-d",
            "--rm",
            "-p",
            "127.0.0.1::3310",
            "-e",
            "CLAMAV_NO_FRESHCLAMD=true",
            _image(),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    try:
        mapping = subprocess.run(
            [DOCKER, "port", container, "3310/tcp"], check=True, capture_output=True, text=True
        ).stdout
        yield int(mapping.strip().splitlines()[0].rsplit(":", 1)[1])
    finally:
        subprocess.run([DOCKER, "stop", container], capture_output=True, check=False)


async def _scan_when_up(scanner: ClamdScanner, path: Path, timeout_s: float = 300):
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            return await scanner.scan(path)
        except ScannerUnavailable:
            if time.monotonic() > deadline:
                raise
            await asyncio.sleep(2)


async def test_eicar_is_detected_and_text_is_clean(clamd_port: int, tmp_path: Path) -> None:
    scanner = ClamdScanner("127.0.0.1", clamd_port)
    clean = tmp_path / "clean.txt"
    clean.write_text("Die Leuchte hat Schutzart IP66.", "utf-8")
    assert not (await _scan_when_up(scanner, clean)).infected

    infected = tmp_path / "eicar.txt"
    infected.write_bytes(eicar())
    verdict = await scanner.scan(infected)
    assert verdict.infected
    assert verdict.signature is not None and "Eicar" in verdict.signature
