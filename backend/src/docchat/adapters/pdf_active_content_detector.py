"""Reads a PDF in pieces and runs the static active-content check on it."""

from pathlib import Path

from docchat.domain.pdf_active_content import ActiveContentScan

_READ_SIZE = 1024 * 1024


class PdfActiveContentDetector:
    def find(self, path: Path) -> frozenset[str]:
        scan = ActiveContentScan()
        with path.open("rb") as file:
            while data := file.read(_READ_SIZE):
                scan.feed(data)
        return scan.finish()
