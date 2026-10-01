"""HTML pages as text: what a reader sees, with headings as chunk context.

The page is untrusted, so it goes through `html.parser`, which fetches and runs nothing. Scripts,
styles, embedded objects, attributes and hidden elements are dropped; hidden text is a classic
place for instructions aimed at a model rather than at people.
"""

import re
from html.parser import HTMLParser

from docchat.domain.errors import ErrorCode, IngestionError
from docchat.domain.parsing import TextContent
from docchat.domain.text_cleanup import normalize_text

# Content of these never reaches the text, whatever is inside.
_SKIPPED = frozenset(
    {"script", "style", "template", "noscript", "iframe", "object", "embed", "svg", "math",
     "canvas", "audio", "video", "select", "button"}
)  # fmt: skip
# `title` lives in `head` but names the page: it is kept as the first heading.
_TITLE = "title"
_HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
_BLOCKS = frozenset(
    {"p", "div", "section", "article", "main", "aside", "header", "footer", "nav", "blockquote",
     "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "figure",
     "figcaption", "address", "details", "summary", "form", "fieldset", "legend", "hr", "br",
     "pre", "body", "html", "caption"}
)  # fmt: skip
_CELLS = frozenset({"td", "th"})
_VOID = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
     "track", "wbr", "param"}
)  # fmt: skip
_HIDING_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")


def _hidden(attrs: list[tuple[str, str | None]]) -> bool:
    for name, value in attrs:
        if name == "hidden":
            return True
        if name == "aria-hidden" and (value or "").strip().lower() == "true":
            return True
        if name == "style" and value and _HIDING_STYLE.search(value):
            return True
    return False


class _Extractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)  # entities are decoded in the text we get
        self.blocks: list[tuple[str, bool]] = []  # (text, is heading)
        self._parts: list[str] = []
        self._heading = False
        self._pre = 0
        self._title = False
        self._title_parts: list[str] = []
        self._skip_tag: str | None = None  # the element whose content is dropped
        self._skip_depth = 0
        self._row_cells = 0

    # Blocks

    def _flush(self) -> None:
        raw = "".join(self._parts)
        self._parts = []
        text = raw if self._pre else _WHITESPACE.sub(" ", raw)
        if text.strip():
            self.blocks.append((text, self._heading))

    # Tokens

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip_tag is not None:
            if tag == self._skip_tag:
                self._skip_depth += 1
            return
        if tag == _TITLE:
            self._title = True
            return
        if tag not in _VOID and (tag in _SKIPPED or _hidden(attrs)):
            self._skip_tag, self._skip_depth = tag, 1
            return
        if tag in _HEADINGS:
            self._flush()
            self._heading = True
        elif tag in _CELLS:
            if self._row_cells:
                self._parts.append(" | ")
            self._row_cells += 1
        elif tag in _BLOCKS:
            self._flush()
            if tag == "tr":
                self._row_cells = 0
            elif tag == "pre":
                self._pre += 1
            elif tag == "li":
                self._parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_tag is not None:
            if tag == self._skip_tag:
                self._skip_depth -= 1
                if self._skip_depth == 0:
                    self._skip_tag = None
            return
        if tag == _TITLE:
            self._title = False
            return
        if tag in _HEADINGS:
            self._flush()
            self._heading = False
        elif tag in _BLOCKS:
            self._flush()
            if tag == "pre" and self._pre:
                self._pre -= 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip_tag is None and tag in _BLOCKS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._skip_tag is not None:
            return
        if self._title:
            self._title_parts.append(data)
        else:
            self._parts.append(data)

    def finish(self) -> None:
        self.close()
        self._flush()
        title = _WHITESPACE.sub(" ", "".join(self._title_parts)).strip()
        if title:
            self.blocks.insert(0, (title, True))


def html_to_text(source: str) -> TextContent:
    """Visible text of an HTML page and its headings (title, h1 to h6) with their offsets."""
    extractor = _Extractor()
    extractor.feed(source)
    extractor.finish()
    pieces: list[str] = []
    headings: list[tuple[int, str]] = []
    offset = 0
    for raw, is_heading in extractor.blocks:
        text = normalize_text(raw).strip()
        if not text:
            continue
        if pieces:
            offset += 2  # the blank line before this block
        if is_heading:
            headings.append((offset, text))
        pieces.append(text)
        offset += len(text)
    if not pieces:
        raise IngestionError(ErrorCode.DOCUMENT_EMPTY)
    return TextContent(text="\n\n".join(pieces), headings=tuple(headings))
