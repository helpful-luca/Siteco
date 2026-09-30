"""pdfium work that runs inside the parser process: page text, sentences, line rectangles.

pdfium is not thread-safe and PDFs are untrusted, so these functions are only ever called
through IsolatedProcess. Everything returned must be picklable.
"""

from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.heading_lines import heading_line_cuts
from docchat.domain.models import Rect
from docchat.domain.parsing import PageBatch, SentenceSpan, TextSection
from docchat.domain.sentences import split_sentences
from docchat.domain.text_cleanup import CleanText, clean_page_text

_PRECISION = 4


def _open(path: Path) -> pdfium.PdfDocument:
    try:
        return pdfium.PdfDocument(path)
    except pdfium.PdfiumError as exc:
        # Only an open password blocks reading; permission-only restrictions open normally.
        if getattr(exc, "err_code", None) == pdfium_c.FPDF_ERR_PASSWORD:
            raise IngestionError(ErrorCode.PDF_ENCRYPTED) from exc
        raise IngestionError(ErrorCode.PDF_CORRUPT) from exc


def normalize_rect(
    box: tuple[float, float, float, float],
    crop: tuple[float, float, float, float],
    rotation: int,
) -> Rect:
    """PDF user space (left, bottom, right, top) to (x, y, w, h) in 0..1 as the page is shown:
    relative to the CropBox, origin top left, page rotation applied (like PDF.js renders it)."""
    left, bottom, right, top = box
    cx0, cy0, cx1, cy1 = crop
    width, height = cx1 - cx0, cy1 - cy0
    x0, x1 = (left - cx0) / width, (right - cx0) / width
    y0, y1 = (cy1 - top) / height, (cy1 - bottom) / height
    if rotation == 90:
        x0, y0, x1, y1 = 1 - y1, x0, 1 - y0, x1
    elif rotation == 180:
        x0, y0, x1, y1 = 1 - x1, 1 - y1, 1 - x0, 1 - y0
    elif rotation == 270:
        x0, y0, x1, y1 = y0, 1 - x1, y1, 1 - x0
    x0, y0 = max(0.0, min(1.0, x0)), max(0.0, min(1.0, y0))
    x1, y1 = max(0.0, min(1.0, x1)), max(0.0, min(1.0, y1))
    return (
        round(x0, _PRECISION),
        round(y0, _PRECISION),
        round(x1 - x0, _PRECISION),
        round(y1 - y0, _PRECISION),
    )


def _heading_cuts(textpage: pdfium.PdfTextPage, cleaned: CleanText) -> list[int]:
    """Sentence cuts around lines in larger type (headings), from pdfium's font sizes."""
    sizes, start = [], 0
    for line in cleaned.text.split("\n"):
        offset = len(line) - len(line.lstrip())
        if start + offset < len(cleaned.raw_index) and line.strip():
            raw = cleaned.raw_index[start + offset]
            sizes.append(float(pdfium_c.FPDFText_GetFontSize(textpage, raw)))
        else:
            sizes.append(0.0)
        start += len(line) + 1
    return heading_line_cuts(cleaned.text, sizes)


def _read_page(pdf: pdfium.PdfDocument, index: int) -> TextSection:
    page = pdf[index]
    textpage = page.get_textpage()
    try:
        raw = textpage.get_text_range()
        # If pdfium's text and its char list disagree, rectangles would point at the wrong
        # characters: fall back to page-level highlighting instead (annex 12, 1d).
        precise = len(raw) == textpage.count_chars()
        cleaned = clean_page_text(raw)
        crop = page.get_cropbox()
        rotation = page.get_rotation()
        cuts = _heading_cuts(textpage, cleaned) if precise else []
        sentences = []
        for start, end in split_sentences(cleaned.text, cuts):
            rects: tuple[Rect, ...] = ()
            if precise:
                raw_start, raw_count = cleaned.raw_span(start, end)
                count = textpage.count_rects(raw_start, raw_count)
                rects = tuple(
                    normalize_rect(textpage.get_rect(i), crop, rotation) for i in range(count)
                )
            sentences.append(SentenceSpan(start, end, rects))
        return TextSection(
            text=cleaned.text,
            sentences=tuple(sentences),
            page=index + 1,
            precise_highlight=precise,
        )
    finally:
        textpage.close()
        page.close()


def count_pages(path: Path) -> int:
    pdf = _open(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def parse_pages(path: Path, first: int, count: int) -> PageBatch:
    """Pages [first, first + count) by 0-based index. Pages pdfium cannot load are reported."""
    pdf = _open(path)
    sections, unreadable = [], []
    try:
        for index in range(first, min(first + count, len(pdf))):
            try:
                sections.append(_read_page(pdf, index))
            except pdfium.PdfiumError:
                unreadable.append(index + 1)
    finally:
        pdf.close()
    return PageBatch(sections=tuple(sections), unreadable_pages=tuple(unreadable))
