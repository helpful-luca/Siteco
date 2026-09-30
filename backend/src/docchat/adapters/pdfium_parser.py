"""PdfParser port: pdfium in its own process, one timeout per page batch."""

from pathlib import Path

from docchat.adapters import pdfium_pages
from docchat.adapters.process_runner import IsolatedProcess, ProcessCrashed, ProcessTimeout
from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.parsing import PageBatch, PageBatchFailed

# A fresh process now and then returns memory that pdfium may keep after large pages.
TASKS_PER_PROCESS = 20


class PdfiumParser:
    def __init__(self, *, timeout_s: float, process: IsolatedProcess | None = None) -> None:
        """`process` is shared with OCR, so all pdfium work stays in one isolated process."""
        self.timeout_s = timeout_s
        self._process = process or IsolatedProcess(max_tasks_per_child=TASKS_PER_PROCESS)

    async def count_pages(self, path: Path) -> int:
        try:
            return await self._process.run(self.timeout_s, pdfium_pages.count_pages, path)
        except ProcessTimeout as exc:
            raise IngestionError(ErrorCode.PROCESSING_TIMEOUT) from exc
        except ProcessCrashed as exc:
            raise IngestionError(ErrorCode.PDF_CORRUPT) from exc

    async def parse_pages(self, path: Path, first: int, count: int) -> PageBatch:
        try:
            return await self._process.run(
                self.timeout_s, pdfium_pages.parse_pages, path, first, count
            )
        except ProcessTimeout as exc:
            raise PageBatchFailed(timed_out=True) from exc
        except ProcessCrashed as exc:
            raise PageBatchFailed(timed_out=False) from exc

    async def close(self) -> None:
        await self._process.close()
