"""PageOcr port with Tesseract, page by page inside the isolated parser process."""

import logging
from pathlib import Path

from docchat.adapters import pdfium_ocr_page
from docchat.adapters.pdfium_ocr_page import OcrOptions
from docchat.adapters.process_runner import IsolatedProcess, ProcessCrashed, ProcessTimeout
from docchat.domain.parsing import TextSection

log = logging.getLogger("docchat.ocr")

# Rendering and starting the process come on top of Tesseract's own time limit.
_PROCESS_MARGIN_S = 15


class TesseractPageOcr:
    available = True

    def __init__(self, process: IsolatedProcess, options: OcrOptions) -> None:
        self._process = process
        self._options = options

    async def recognize(self, path: Path, page: int) -> TextSection | None:
        """None if the page has no readable text, or OCR failed or timed out on it."""
        try:
            return await self._process.run(
                self._options.timeout_s + _PROCESS_MARGIN_S,
                pdfium_ocr_page.recognize_page,
                path,
                page - 1,
                self._options,
            )
        except (ProcessTimeout, ProcessCrashed):
            log.warning("ocr_page_lost", extra={"page": page})
            return None
