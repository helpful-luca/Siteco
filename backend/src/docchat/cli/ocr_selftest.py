"""Proves OCR works in this image: pdfium renders a generated page, Tesseract (deu+eng) reads it.

Run by the fresh clone test and CI inside the backend container:
`python -m docchat.cli.ocr_selftest` prints `ocr OK` or exits with 1.
"""

import sys
import tempfile
from pathlib import Path

from docchat.adapters.pdfium_ocr_page import OcrOptions, recognize_page

_LINES = ("Die Straßenleuchte Mira hat die Schutzart IP66.", "The housing is made of aluminium.")
_EXPECTED = ("Straßenleuchte", "IP66", "aluminium")


def _pdf(lines: tuple[str, ...]) -> bytes:
    """One letter page with Helvetica lines; WinAnsi encoding covers the German letters."""
    text = b"\n".join(
        b"BT /F1 16 Tf 72 %d Td (%s) Tj ET" % (720 - 28 * i, line.encode("cp1252"))
        for i, line in enumerate(lines)
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]"
        b" /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text),
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "selftest.pdf"
        path.write_bytes(_pdf(_LINES))
        section = recognize_page(path, 0, OcrOptions())
    text = section.text if section else ""
    missing = [word for word in _EXPECTED if word not in text]
    if section is None or missing or not all(s.rects for s in section.sentences):
        print(f"ocr self test failed, missing: {missing or 'rects'}", file=sys.stderr)
        return 1
    print("ocr OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
