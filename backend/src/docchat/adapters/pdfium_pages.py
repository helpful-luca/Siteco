"""pdfium work that runs inside the parser process: page text, sentences, line rectangles.

pdfium is not thread-safe and PDFs are untrusted, so these functions are only ever called
through IsolatedProcess. Everything returned must be picklable.
"""

import ctypes
import math
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.line_breaks import PageLine, line_break_cuts
from docchat.domain.models import Rect
from docchat.domain.page_title import page_title
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


def _font_size(textpage: pdfium.PdfTextPage, index: int) -> float:
    """The size the character is shown at. Layout programs often set size 1 and scale the text
    matrix, so the nominal size alone says nothing."""
    matrix = pdfium_c.FS_MATRIX()
    nominal = float(pdfium_c.FPDFText_GetFontSize(textpage, index))
    if not pdfium_c.FPDFText_GetMatrix(textpage, index, ctypes.byref(matrix)):
        return nominal
    return nominal * math.hypot(matrix.c, matrix.d)


def _middle_char(cleaned: CleanText, start: int, line: str) -> int:
    """Raw index of a visible character mid-line: the first may be a bullet from a symbol font,
    and the spaces pdfium inserts have no font at all."""
    visible = [i for i, char in enumerate(line) if not char.isspace()]
    return cleaned.raw_index[start + visible[len(visible) // 2]]


def _page_lines(
    textpage: pdfium.PdfTextPage, cleaned: CleanText, crop_top: float
) -> list[PageLine]:
    """Geometry of every non-empty line of the cleaned text, for the layout cuts."""
    lines, start = [], 0
    for part in cleaned.text.split("\n"):
        stripped = part.strip()
        if stripped:
            first = start + len(part) - len(part.lstrip())
            raw_start, raw_count = cleaned.raw_span(first, first + len(stripped))
            count = textpage.count_rects(raw_start, raw_count)
            boxes = [textpage.get_rect(i) for i in range(count)]
            word_end = first + len(stripped.split()[0])
            word_raw_start, word_raw_count = cleaned.raw_span(first, word_end)
            word = [
                textpage.get_charbox(i)
                for i in range(word_raw_start, word_raw_start + word_raw_count)
            ]
            if boxes:
                lines.append(
                    PageLine(
                        start=first,
                        end=first + len(stripped),
                        spans=tuple((box[0], box[2]) for box in boxes),
                        top=crop_top - boxes[0][3],
                        last_top=crop_top - boxes[-1][3],
                        size=_font_size(textpage, _middle_char(cleaned, first, stripped)),
                        first_word=max(b[2] for b in word) - min(b[0] for b in word),
                    )
                )
        start += len(part) + 1
    return lines


def _off_page_chars(
    textpage: pdfium.PdfTextPage, raw: str, crop: tuple[float, float, float, float]
) -> frozenset[int]:
    """Characters whose center lies outside the CropBox. Layout programs that export spreads
    leave the facing page's text there: invisible, and it belongs to another page."""
    left, bottom, right, top = crop
    hidden = set()
    for i, char in enumerate(raw):
        if char.isspace():
            continue
        x0, y0, x1, y1 = textpage.get_charbox(i)
        if x0 == x1 == y0 == y1 == 0:
            continue  # generated by pdfium, no geometry
        if not (left <= (x0 + x1) / 2 <= right and bottom <= (y0 + y1) / 2 <= top):
            hidden.add(i)
    return frozenset(hidden)


def _read_page(pdf: pdfium.PdfDocument, index: int) -> TextSection:
    page = pdf[index]
    textpage = page.get_textpage()
    try:
        crop = page.get_cropbox()
        raw = textpage.get_text_range()
        # If pdfium's text and its char list disagree, rectangles would point at the wrong
        # characters: fall back to page-level highlighting instead.
        precise = len(raw) == textpage.count_chars()
        if precise:
            cleaned = clean_page_text(raw, _off_page_chars(textpage, raw, crop))
        else:
            cleaned = clean_page_text(textpage.get_text_bounded(*crop))
        rotation = page.get_rotation()
        # The layout cuts sentences at line breaks that end a heading, a table row, a list
        # item or a paragraph, and names the page by its title.
        lines = _page_lines(textpage, cleaned, crop[3]) if precise else []
        cuts = line_break_cuts(cleaned.text, lines)
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
            heading=page_title(cleaned.text, lines),
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
