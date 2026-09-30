"""OCR switched off (`OCR=off`) or Tesseract missing: pages without text stay without text."""

from pathlib import Path

from docchat.domain.parsing import TextSection


class NoPageOcr:
    available = False

    async def recognize(self, path: Path, page: int) -> TextSection | None:
        return None
