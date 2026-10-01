"""Builds the fictional eval datasheets: eval/datasheets/<slug>.md to eval/documents/<slug>.pdf.

Run from backend/: `uv run python -m tests.eval.build_datasheets`. The output is deterministic, so
rerunning it leaves the committed PDFs byte-identical.

Markdown subset: the first line is `<!-- footer: ... -->` (with optional {page} and {pages}),
`<!-- page -->` starts a new page, `# ` and `## ` are headings, a blank line adds paragraph space
and every other line is body text, wrapped to the page width.
"""

import re
import textwrap
from dataclasses import dataclass
from pathlib import Path

from tests.pdf_factory import PageSpec, TextLine, build_pdf

EVAL_DIR = Path(__file__).resolve().parents[3] / "eval"
SOURCE_DIR = EVAL_DIR / "datasheets"
OUTPUT_DIR = EVAL_DIR / "documents"

PAGE_BREAK = "<!-- page -->"
FOOTER = re.compile(r"<!-- footer: (?P<text>.+?) -->")

LEFT = 60.0
TOP = 750.0
FOOTER_Y = 36.0
BOTTOM = 64.0  # body text must stay above this line, clear of the footer
WRAP = 92  # characters per body line, about the text width of Helvetica 10.5 pt

# Font size and line height per kind of line, in points
HEADING_1 = (16.0, 24.0)
HEADING_2 = (13.0, 19.0)
BODY = (10.5, 14.0)
PARAGRAPH_GAP = 7.0
FOOTER_SIZE = 8.0


@dataclass(frozen=True)
class Datasheet:
    slug: str
    footer: str
    pages: list[list[str]]


def parse(slug: str, markdown: str) -> Datasheet:
    lines = markdown.splitlines()
    match = FOOTER.fullmatch(lines[0].strip()) if lines else None
    if match is None:
        raise ValueError(f"{slug}: the first line must be <!-- footer: ... -->")
    pages: list[list[str]] = [[]]
    for line in lines[1:]:
        if line.strip() == PAGE_BREAK:
            pages.append([])
        else:
            pages[-1].append(line.rstrip())
    return Datasheet(slug=slug, footer=match["text"], pages=pages)


def layout_page(source: list[str], footer: str) -> PageSpec:
    lines: list[TextLine] = []
    y = TOP
    for raw in _trim_blank(source):
        if not raw:
            y -= PARAGRAPH_GAP
            continue
        if raw.startswith("# "):
            texts, (size, height) = [raw[2:]], HEADING_1
        elif raw.startswith("## "):
            y -= PARAGRAPH_GAP  # extra air above a section heading
            texts, (size, height) = [raw[3:]], HEADING_2
        else:
            texts = textwrap.wrap(raw, WRAP, break_long_words=False, break_on_hyphens=False)
            size, height = BODY
        for text in texts:
            if y < BOTTOM:
                raise ValueError(f"page overflows at line: {text!r}")
            lines.append(TextLine(text, x=LEFT, y=y, size=size))
            y -= height
    lines.append(TextLine(footer, x=LEFT, y=FOOTER_Y, size=FOOTER_SIZE))
    return PageSpec(lines=lines)


def build(sheet: Datasheet) -> bytes:
    total = len(sheet.pages)
    specs = [
        layout_page(page, sheet.footer.format(page=number, pages=total))
        for number, page in enumerate(sheet.pages, start=1)
    ]
    return build_pdf(specs)


def _trim_blank(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start]:
        start += 1
    while end > start and not lines[end - 1]:
        end -= 1
    return lines[start:end]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for source in sorted(SOURCE_DIR.glob("*.md")):
        sheet = parse(source.stem, source.read_text(encoding="utf-8"))
        target = OUTPUT_DIR / f"{source.stem}.pdf"
        target.write_bytes(build(sheet))
        print(f"{target.relative_to(EVAL_DIR)}: {len(sheet.pages)} pages")


if __name__ == "__main__":
    main()
