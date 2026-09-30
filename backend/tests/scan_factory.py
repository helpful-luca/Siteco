"""Scanned pages for OCR tests: a text page rendered by pdfium and stored as one image, no text."""

import pypdfium2 as pdfium

from tests.pdf_factory import GrayImage, PageSpec, build_pdf, text_page


def scanned_page(*lines: str, dpi: int = 200, size: float = 14, leading: float = 20) -> PageSpec:
    pdf = pdfium.PdfDocument(build_pdf([text_page(*lines, size=size, leading=leading)]))
    try:
        page = pdf[0]
        bitmap = page.render(scale=dpi / 72, grayscale=True)
        pixels = bytes(bitmap.buffer)
        rows = [
            pixels[row * bitmap.stride : row * bitmap.stride + bitmap.width]
            for row in range(bitmap.height)
        ]
        return PageSpec(scan=GrayImage(bitmap.width, bitmap.height, b"".join(rows)))
    finally:
        pdf.close()
