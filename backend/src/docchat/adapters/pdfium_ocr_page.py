"""OCR of one PDF page, run inside the parser process: pdfium renders, Tesseract reads.

The page is rendered as it is displayed (CropBox and /Rotate applied by pdfium), so the word boxes
normalized to the image are already in the viewer's coordinates. The image goes to Tesseract as a
grayscale PGM on stdin; nothing is written to disk and Tesseract gets a minimal environment.
"""

import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium

from docchat.domain.ocr_text import ocr_section, parse_tesseract_tsv
from docchat.domain.parsing import TextSection

log = logging.getLogger("docchat.ocr")


@dataclass(frozen=True)
class OcrOptions:
    languages: str = "deu+eng"
    dpi: int = 300
    # Large drawings (A0 plans) would become gigapixel images at 300 dpi.
    max_side_px: int = 5000
    timeout_s: float = 60
    binary: str = "tesseract"


def _pgm(bitmap: pdfium.PdfBitmap) -> bytes:
    """8-bit grayscale bitmap to binary PGM; pdfium rows may be padded to the stride."""
    data = bytes(bitmap.buffer)
    if bitmap.stride != bitmap.width:
        data = b"".join(
            data[row * bitmap.stride : row * bitmap.stride + bitmap.width]
            for row in range(bitmap.height)
        )
    return b"P5\n%d %d\n255\n" % (bitmap.width, bitmap.height) + data


def _tesseract(image: bytes, dpi: int, options: OcrOptions) -> str | None:
    command = [
        options.binary, "stdin", "stdout",
        "-l", options.languages, "--psm", "3", "--dpi", str(dpi), "tsv",
    ]  # fmt: skip
    # One thread per page: OpenMP on every core would slow down answers during a large upload.
    env = {"PATH": os.environ.get("PATH", ""), "OMP_THREAD_LIMIT": "1", "LC_ALL": "C.UTF-8"}
    try:
        result = subprocess.run(
            command,
            input=image,
            capture_output=True,
            timeout=options.timeout_s,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        log.warning("ocr_page_timeout")
        return None
    except OSError:
        log.warning("ocr_binary_failed")
        return None
    if result.returncode != 0:
        log.warning("ocr_page_failed", extra={"returncode": result.returncode})
        return None
    return result.stdout.decode("utf-8", errors="replace")


def _render(
    path: Path, index: int, options: OcrOptions
) -> tuple[bytes, tuple[int, int], int] | None:
    """The page as a PGM image, its pixel size and its effective resolution."""
    pdf = pdfium.PdfDocument(path)
    try:
        page = pdf[index]
        try:
            if next(page.get_objects(), None) is None:
                return None  # an empty page: nothing to read, no need to spend seconds on it
            width, height = page.get_size()
            scale = min(options.dpi / 72, options.max_side_px / max(width, height, 1))
            bitmap = page.render(scale=scale, grayscale=True, draw_annots=False)
            try:
                # Tesseract sizes its models by dpi: a downscaled large page tells the truth.
                return _pgm(bitmap), (bitmap.width, bitmap.height), max(1, round(scale * 72))
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        pdf.close()


def recognize_page(path: Path, index: int, options: OcrOptions) -> TextSection | None:
    """Page `index` (0-based) as a section with sentence rectangles, or None without text.
    A page pdfium cannot open or render is None too: one bad page must not stop the document."""
    try:
        rendered = _render(path, index, options)
    except pdfium.PdfiumError:
        log.warning("ocr_page_unreadable")
        return None
    if rendered is None:
        return None
    image, size, dpi = rendered
    tsv = _tesseract(image, dpi, options)
    if tsv is None:
        return None
    words = parse_tesseract_tsv(tsv)
    return ocr_section(words, width=size[0], height=size[1], page=index + 1)
