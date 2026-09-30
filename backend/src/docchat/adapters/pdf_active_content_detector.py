"""Reads a PDF in pieces and runs the static active-content check on it, within a time budget."""

import time
from pathlib import Path

from docchat.domain.pdf_active_content import ActiveContentScan

_READ_SIZE = 1024 * 1024


class PdfActiveContentDetector:
    def __init__(self, time_budget_s: float = 30.0) -> None:
        self._time_budget_s = time_budget_s

    def find(self, path: Path) -> frozenset[str]:
        scan = ActiveContentScan()
        deadline = time.monotonic() + self._time_budget_s
        with path.open("rb") as file:
            while data := file.read(_READ_SIZE):
                if time.monotonic() > deadline:
                    scan.stop()  # only a hint: never hold up ingestion for it
                    break
                scan.feed(data)
        return scan.finish()
