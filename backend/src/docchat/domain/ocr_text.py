"""OCR words to page text with sentence rectangles, like a PDF page with a text layer.

Tesseract reports every word with its box and its block, paragraph and line. Words of a line are
joined by spaces, lines by a newline and paragraphs by a blank line, so the sentence splitter and
the chunker see the same shapes as on a text PDF. A sentence gets one rectangle per OCR line it
touches: the union of its word boxes on that line.
"""

import re
import unicodedata
from dataclasses import dataclass

from docchat.domain.models import Rect
from docchat.domain.parsing import SentenceSpan, TextSection
from docchat.domain.sentences import split_sentences

_PRECISION = 4
_WORD_LEVEL = "5"
_COLUMNS = 12
# Below this confidence (0 to 100) a "word" is mostly a shape in a photo read as letters: on
# the Siteco catalog's photo pages the mean is about 34, on scanned text about 95.
MIN_WORD_CONFIDENCE = 50.0

LineKey = tuple[int, int, int]  # block, paragraph, line
# Tesseract reads the unit lumen as "Im" (capital i) in sans-serif type; after a number it is
# never the German word.
_LUMEN = re.compile(r"^Im(?=$|[/.,;:)])")


@dataclass(frozen=True)
class OcrWord:
    text: str
    left: int
    top: int
    width: int
    height: int
    line: LineKey


def parse_tesseract_tsv(tsv: str) -> list[OcrWord]:
    """Word rows of `tesseract ... tsv` output. Rows that do not parse and words Tesseract is
    unsure about are skipped."""
    words = []
    for row in tsv.splitlines()[1:]:
        cells = row.split("\t")
        if len(cells) != _COLUMNS or cells[0] != _WORD_LEVEL or not cells[11].strip():
            continue
        try:
            block, paragraph, line = int(cells[2]), int(cells[3]), int(cells[4])
            left, top, width, height = (int(c) for c in cells[6:10])
            confidence = float(cells[10])
        except ValueError:
            continue
        if confidence < MIN_WORD_CONFIDENCE:
            continue
        words.append(OcrWord(cells[11].strip(), left, top, width, height, (block, paragraph, line)))
    return words


def _normalize(box: tuple[int, int, int, int], width: int, height: int) -> Rect:
    x0, y0, x1, y1 = box
    return (
        round(x0 / width, _PRECISION),
        round(y0 / height, _PRECISION),
        round((x1 - x0) / width, _PRECISION),
        round((y1 - y0) / height, _PRECISION),
    )


def ocr_section(words: list[OcrWord], *, width: int, height: int, page: int) -> TextSection:
    """A page section from OCR words; boxes are pixels of an image of `width` x `height`."""
    if width <= 0 or height <= 0:
        raise ValueError("image size must be positive")
    parts: list[str] = []
    spans: list[tuple[int, int, OcrWord]] = []  # word start and end in the text
    length = 0
    previous: OcrWord | None = None
    for word in words:
        text = unicodedata.normalize("NFC", word.text)
        if previous is not None and previous.text[-1:].isdigit():
            text = _LUMEN.sub("lm", text, count=1)
        if previous is not None:
            same_paragraph = previous.line[:2] == word.line[:2]
            separator = " " if previous.line == word.line else "\n" if same_paragraph else "\n\n"
            parts.append(separator)
            length += len(separator)
        spans.append((length, length + len(text), word))
        parts.append(text)
        length += len(text)
        previous = word
    text = "".join(parts)

    sentences = []
    for start, end in split_sentences(text):
        lines: dict[LineKey, tuple[int, int, int, int]] = {}
        for word_start, word_end, word in spans:
            if word_start >= end or word_end <= start:
                continue
            box = (word.left, word.top, word.left + word.width, word.top + word.height)
            if word.line in lines:
                x0, y0, x1, y1 = lines[word.line]
                box = (min(x0, box[0]), min(y0, box[1]), max(x1, box[2]), max(y1, box[3]))
            lines[word.line] = box
        rects = tuple(_normalize(box, width, height) for box in lines.values())
        sentences.append(SentenceSpan(start, end, rects))
    return TextSection(text=text, sentences=tuple(sentences), page=page, precise_highlight=True)
