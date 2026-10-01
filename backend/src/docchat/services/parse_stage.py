"""Parse pass: file -> sections -> chunks in the spool. Pages are parsed in batches.

A PDF page without a title of its own (a continuation page of a product, a page of a chapter)
keeps the title of the page before it as its heading, like a section of a text file."""

import asyncio
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
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

    async def _with_ocr(
        self,
        path: Path,
        sections: Sequence[TextSection],
        report: ProgressReporter,
        batch: range,
        pages: int,
    ) -> tuple[list[TextSection], int]:
        """Pages without a text layer go to OCR one by one (seconds each), with progress inside
        the batch and a notice naming the page. Returns the sections and the recognized count."""
        blank = [s.page for s in sections if not s.has_text and s.page is not None]
        if not blank or not self._ocr.available:
            return list(sections), 0
        by_page = {s.page: s for s in sections}
        for done, page in enumerate(blank):
            await report.notices([Notice(NoticeCode.OCR_RUNNING, {"page": page, "pages": pages})])
            recognized = await self._ocr.recognize(path, page)
            if recognized is not None and recognized.has_text:
                by_page[page] = recognized
            await report((batch.start + (done + 1) / len(blank) * len(batch)) / pages)
        await report.notices([])
        ocr_pages = sum(1 for page in blank if by_page[page].has_text)
        return [by_page[page] for page in sorted(p for p in by_page if p is not None)], ocr_pages

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
        ocr_pages = 0
        skipped: list[int] = []
        failed_batches = 0
        title = ""  # the last page title, for the pages after it that have none
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
            sections, recognized = await self._with_ocr(
                path, batch.sections, report, range(first, last), pages
            )
            ocr_pages += recognized
            without_text.extend(s.page for s in sections if not s.has_text and s.page)
            titled = []
            for section in (s for s in sections if s.has_text):
                title = section.heading or title
                titled.append(replace(section, heading=title))
            await asyncio.to_thread(sink.add, titled)
            await report(last / pages)
        if sink.chunks == 0:
            raise IngestionError(ErrorCode.PDF_NO_TEXT if without_text else ErrorCode.PDF_CORRUPT)
        notices = []
        # Static check for scripts, launch actions and attachments. Only a
        # hint: the text is extracted and the viewer runs nothing.
        if await asyncio.to_thread(self._active_content.find, path):
            notices.append(Notice(NoticeCode.PDF_ACTIVE_CONTENT))
        if ocr_pages:
            notices.append(Notice(NoticeCode.PAGES_OCR, {"count": ocr_pages}))
        if without_text:
            notices.append(Notice(NoticeCode.PAGES_WITHOUT_TEXT, {"count": len(without_text)}))
            if self._ocr.engine_missing:
                notices.append(Notice(NoticeCode.OCR_ENGINE_MISSING))
        if skipped:
            notices.append(Notice(NoticeCode.PAGES_SKIPPED, {"count": len(skipped)}))
        return ParseOutcome(pages, sink.chunks, sink.chars, tuple(notices))
