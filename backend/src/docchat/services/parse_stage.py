"""Parse pass: file -> sections -> chunks in the spool. Pages are parsed in batches."""

import asyncio
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from docchat.domain.chunking import chunk_section
from docchat.domain.enums import DocumentKind
from docchat.domain.errors import ErrorCode, IngestionError, NoticeCode
from docchat.domain.models import Document, Notice
from docchat.domain.parsing import PageBatchFailed, TextSection
from docchat.domain.ports import (
    ActiveContentDetector,
    ChunkSpool,
    PageOcr,
    PdfParser,
    SpoolWriter,
    TextParser,
)
from docchat.domain.text_sections import text_sections
from docchat.services.ingestion_progress import ProgressReporter


@dataclass(frozen=True)
class ParseLimits:
    max_pdf_pages: int
    max_chars: int
    batch_pages: int
    max_failed_batches: int


@dataclass(frozen=True)
class ParseOutcome:
    page_count: int | None
    chunk_count: int
    char_count: int
    notices: tuple[Notice, ...]


class _ChunkSink:
    """Chunks sections into the spool and keeps the running totals."""

    def __init__(self, document: Document, writer: SpoolWriter, max_chars: int) -> None:
        self._document = document
        self._writer = writer
        self._max_chars = max_chars
        self.chunks = 0
        self.chars = 0

    def add(self, sections: Iterable[TextSection]) -> None:
        for section in sections:
            self.chars += len(section.text)
            if self.chars > self._max_chars:
                raise IngestionError(ErrorCode.DOCUMENT_TOO_LONG)
            chunks = chunk_section(
                section,
                document_id=self._document.id,
                document_name=self._document.filename,
                first_ordinal=self.chunks,
            )
            self._writer.write(chunks)
            self.chunks += len(chunks)


class ParseStage:
    def __init__(
        self,
        spool: ChunkSpool,
        pdf_parser: PdfParser,
        text_parser: TextParser,
        ocr: PageOcr,
        active_content: ActiveContentDetector,
        limits: ParseLimits,
    ) -> None:
        self._spool = spool
        self._pdf_parser = pdf_parser
        self._text_parser = text_parser
        self._ocr = ocr
        self._active_content = active_content
        self._limits = limits

    async def run(self, document: Document, path: Path, report: ProgressReporter) -> ParseOutcome:
        writer = await asyncio.to_thread(self._spool.writer, document.id)
        sink = _ChunkSink(document, writer, self._limits.max_chars)
        try:
            if document.kind is DocumentKind.PDF:
                return await self._parse_pdf(path, sink, report)
            return await self._parse_text(document.kind, path, sink, report)
        finally:
            await asyncio.to_thread(writer.close)

    async def _parse_text(
        self, kind: DocumentKind, path: Path, sink: _ChunkSink, report: ProgressReporter
    ) -> ParseOutcome:
        content = await asyncio.to_thread(
            self._text_parser.parse, path, kind, self._limits.max_chars
        )
        total = max(1, len(content.text))
        for section in text_sections(content):
            await asyncio.to_thread(sink.add, [section])
            await report((section.offset + len(section.text)) / total)
        if sink.chunks == 0:
            raise IngestionError(ErrorCode.DOCUMENT_EMPTY)
        return ParseOutcome(None, sink.chunks, sink.chars, ())

    async def _with_ocr(self, path: Path, sections: Sequence[TextSection]) -> list[TextSection]:
        """Pages without a text layer go to OCR (a no-op until phase 5b)."""
        blank = [s.page for s in sections if not s.has_text and s.page is not None]
        recognized = await self._ocr.recognize(path, blank) if blank else []
        by_page = {s.page: s for s in sections} | {s.page: s for s in recognized}
        return [by_page[page] for page in sorted(p for p in by_page if p is not None)]

    async def _parse_pdf(
        self, path: Path, sink: _ChunkSink, report: ProgressReporter
    ) -> ParseOutcome:
        pages = await self._pdf_parser.count_pages(path)
        if pages > self._limits.max_pdf_pages:
            raise IngestionError(ErrorCode.PDF_TOO_MANY_PAGES)
        if pages == 0:
            raise IngestionError(ErrorCode.DOCUMENT_EMPTY)
        await report(0.0, page_count=pages)
        without_text: list[int] = []
        skipped: list[int] = []
        failed_batches = 0
        step = self._limits.batch_pages
        for first in range(0, pages, step):
            last = min(first + step, pages)
            try:
                batch = await self._pdf_parser.parse_pages(path, first, last - first)
            except PageBatchFailed as failure:
                failed_batches += 1
                if failed_batches >= self._limits.max_failed_batches:
                    code = (
                        ErrorCode.PROCESSING_TIMEOUT
                        if failure.timed_out
                        else ErrorCode.PROCESSING_FAILED
                    )
                    raise IngestionError(code) from failure
                skipped.extend(range(first + 1, last + 1))
                continue
            skipped.extend(batch.unreadable_pages)
            sections = await self._with_ocr(path, batch.sections)
            without_text.extend(s.page for s in sections if not s.has_text and s.page)
            await asyncio.to_thread(sink.add, [s for s in sections if s.has_text])
            await report(last / pages)
        if sink.chunks == 0:
            raise IngestionError(ErrorCode.PDF_NO_TEXT if without_text else ErrorCode.PDF_CORRUPT)
        notices = []
        # Static check for scripts, launch actions and attachments (master spec 6.9). Only a
        # hint: the text is extracted and the viewer runs nothing.
        if await asyncio.to_thread(self._active_content.find, path):
            notices.append(Notice(NoticeCode.PDF_ACTIVE_CONTENT))
        if without_text:
            notices.append(Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": len(without_text)}))
        if skipped:
            notices.append(Notice(NoticeCode.PAGES_SKIPPED, {"count": len(skipped)}))
        return ParseOutcome(pages, sink.chunks, sink.chars, tuple(notices))
