"""OCR switched off (`OCR=off`) or Tesseract missing: pages without text stay without text."""

from pathlib import Path

from docchat.domain.parsing import TextSection


class NoPageOcr:
    available = False

    def __init__(self, *, engine_missing: bool = False) -> None:
        self.engine_missing = engine_missing  # OCR is on, but there is no Tesseract here

    async def recognize(self, path: Path, page: int) -> TextSection | None:
        return None
