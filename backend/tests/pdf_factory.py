"""A tiny PDF writer for test fixtures. Fixtures are generated at test time, never committed.

Supports text lines in Helvetica (WinAnsi, so German umlauts work), page rotation, a CropBox that
differs from the MediaBox, image-only pages, pages that are one grayscale image (a scan) and the
standard security handler (RC4, revision 2) for password protected files.
"""

import hashlib
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, field

import pypdfium2 as pdfium

_PASSWORD_PAD = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")
_FILE_ID = bytes.fromhex("0123456789abcdef0123456789abcdef")


@dataclass(frozen=True)
class TextLine:
    text: str
    x: float = 72
    y: float = 720
    size: float = 12


@dataclass(frozen=True)
class GrayImage:
    """8-bit grayscale pixels, row by row, drawn over the whole page."""

    width: int
    height: int
    pixels: bytes


@dataclass(frozen=True)
class PageSpec:
    lines: Sequence[TextLine] = ()
    rotate: int = 0
    media_box: tuple[float, float, float, float] = (0, 0, 612, 792)
    crop_box: tuple[float, float, float, float] | None = None
    image_only: bool = False
    scan: GrayImage | None = None


@dataclass
class _Writer:
    objects: list[bytes] = field(default_factory=list)

    def reserve(self) -> int:
        self.objects.append(b"")
        return len(self.objects)

    def set(self, number: int, body: bytes) -> None:
        self.objects[number - 1] = body


def text_page(*paragraphs: str, size: float = 11, leading: float = 14) -> PageSpec:
    """One line per string, top to bottom, starting near the top margin."""
    lines = [TextLine(text, y=740 - i * leading, size=size) for i, text in enumerate(paragraphs)]
    return PageSpec(lines=lines)


def build_pdf(
    pages: Sequence[PageSpec], *, user_password: str | None = None, owner_password: str = ""
) -> bytes:
    """Returns the bytes of a valid PDF. A password (even empty) switches on encryption."""
    encrypt = user_password is not None or owner_password != ""
    crypt = _Rc4Security(user_password or "", owner_password or "owner") if encrypt else None
    w = _Writer()
    catalog, page_tree, font = w.reserve(), w.reserve(), w.reserve()
    w.set(
        font, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    kids: list[int] = []
    for spec in pages:
        page, content = w.reserve(), w.reserve()
        kids.append(page)
        stream = _content_stream(spec)
        if crypt:
            stream = crypt.encrypt(content, stream)
        w.set(content, b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        image = None
        if spec.scan is not None:
            image = w.reserve()
            w.set(image, _image_object(spec.scan))
        w.set(page, _page_dict(spec, page_tree, content, font, image))
    kid_refs = b" ".join(b"%d 0 R" % k for k in kids)
    w.set(page_tree, b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kid_refs, len(kids)))
    w.set(catalog, b"<< /Type /Catalog /Pages %d 0 R >>" % page_tree)
    encrypt_ref = None
    if crypt:
        encrypt_ref = w.reserve()
        w.set(encrypt_ref, crypt.dictionary())
    return _serialize(w.objects, catalog, encrypt_ref)


def _image_object(scan: GrayImage) -> bytes:
    data = zlib.compress(scan.pixels)
    return (
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray"
        b" /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n"
        % (scan.width, scan.height, len(data))
        + data
        + b"\nendstream"
    )


def _page_dict(
    spec: PageSpec, parent: int, content: int, font: int, image: int | None = None
) -> bytes:
    xobject = b" /XObject << /Im1 %d 0 R >>" % image if image else b""
    parts = [
        b"<< /Type /Page /Parent %d 0 R" % parent,
        b" /MediaBox [%s]" % _numbers(spec.media_box),
        b" /Resources << /Font << /F1 %d 0 R >>%s >>" % (font, xobject),
        b" /Contents %d 0 R" % content,
    ]
    if spec.crop_box:
        parts.append(b" /CropBox [%s]" % _numbers(spec.crop_box))
    if spec.rotate:
        parts.append(b" /Rotate %d" % spec.rotate)
    parts.append(b" >>")
    return b"".join(parts)


def _content_stream(spec: PageSpec) -> bytes:
    if spec.scan is not None:
        x0, y0, x1, y1 = spec.media_box
        size = (_num(x1 - x0), _num(y1 - y0), _num(x0), _num(y0))
        return b"q %s 0 0 %s %s %s cm /Im1 Do Q" % size
    if spec.image_only:
        # Vector shapes stand in for a scanned image: something is drawn, but there is no text.
        return b"0.2 g 72 400 468 300 re f 0.8 g 100 450 200 100 re f"
    ops = []
    for line in spec.lines:
        text = line.text.encode("cp1252")
        escaped = text.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
        ops.append(
            b"BT /F1 %s Tf %s %s Td (%s) Tj ET"
            % (_num(line.size), _num(line.x), _num(line.y), escaped)
        )
    return b"\n".join(ops)


def _serialize(objects: list[bytes], root: int, encrypt: int | None) -> bytes:
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    trailer = b"<< /Size %d /Root %d 0 R" % (len(objects) + 1, root)
    if encrypt:
        trailer += b" /Encrypt %d 0 R" % encrypt
    trailer += b" /ID [<%s> <%s>] >>" % (_FILE_ID.hex().encode(), _FILE_ID.hex().encode())
    out += b"trailer\n" + trailer + b"\nstartxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def _num(value: float) -> bytes:
    return (f"{value:g}").encode()


def _numbers(values: Sequence[float]) -> bytes:
    return b" ".join(_num(v) for v in values)


def _rc4(key: bytes, data: bytes) -> bytes:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    out = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def _pad(password: str) -> bytes:
    return (password.encode("latin-1") + _PASSWORD_PAD)[:32]


class _Rc4Security:
    """PDF standard security handler, revision 2 (40-bit RC4). Old, but every reader opens it."""

    permissions = -44  # printing and copying forbidden, like a typical "protected" PDF

    def __init__(self, user_password: str, owner_password: str) -> None:
        owner_key = hashlib.md5(_pad(owner_password)).digest()[:5]
        self.owner_entry = _rc4(owner_key, _pad(user_password))
        seed = (
            _pad(user_password)
            + self.owner_entry
            + self.permissions.to_bytes(4, "little", signed=True)
            + _FILE_ID
        )
        self.key = hashlib.md5(seed).digest()[:5]
        self.user_entry = _rc4(self.key, _PASSWORD_PAD)

    def encrypt(self, number: int, data: bytes) -> bytes:
        object_key = hashlib.md5(self.key + number.to_bytes(3, "little") + b"\0\0").digest()
        return _rc4(object_key[:10], data)

    def dictionary(self) -> bytes:
        return b"<< /Filter /Standard /V 1 /R 2 /O <%s> /U <%s> /P %d >>" % (
            self.owner_entry.hex().encode(),
            self.user_entry.hex().encode(),
            self.permissions,
        )


def scanned_page(*lines: str, dpi: int = 200, size: float = 14, leading: float = 20) -> PageSpec:
    """A text page rendered by pdfium and stored as one grayscale image, with no text layer."""
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
