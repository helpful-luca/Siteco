"""Questions about a page ("Was steht auf Seite 56?"). Pure functions, no I/O.

A page question wants that page, not whatever the embedding finds similar to the words "page
56", so retrieval fetches the page's passages directly (retrieval service).
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass

MAX_PAGES = 20  # "Seiten 1 bis 900" is not a page lookup; the first pages are enough
_DASHES = chr(0x2013) + chr(0x2014)  # typed as codes: no dash characters in the source
_PAGE = re.compile(
    r"(?<!\w)(?:seiten?|pages?|pp?\.|s\.)\s*(\d{1,4})"
    rf"(?:\s*(bis|to|[-{_DASHES}]|und|and|&)\s*(\d{{1,4}}))?",
    re.IGNORECASE,
)
_NOT_ALNUM = re.compile(r"[\W_]+")
_RANGE_WORDS = frozenset({"bis", "to", "-", *_DASHES})


@dataclass(frozen=True)
class PageRequest:
    pages: tuple[int, ...]  # ascending, without duplicates, at most MAX_PAGES


def find_page_request(question: str) -> PageRequest | None:
    pages: list[int] = []
    for match in _PAGE.finditer(question):
        first = int(match.group(1))
        if first < 1:
            continue
        joiner, last_text = match.group(2), match.group(3)
        if joiner is None or last_text is None:
            pages.append(first)
        elif joiner.lower() in _RANGE_WORDS:
            last = int(last_text)
            pages.extend(range(first, max(first, last) + 1))
        else:  # "Seiten 56 und 58": a list
            pages.extend((first, int(last_text)))
    unique = sorted(set(pages))[:MAX_PAGES]
    return PageRequest(tuple(unique)) if unique else None


def strip_page_references(question: str) -> str:
    """The question without "Seite 56" and the like, so the page number is not a search term."""
    return _PAGE.sub(" ", question)


def _normalized(text: str) -> str:
    return _NOT_ALNUM.sub(" ", text.casefold()).strip()


def named_document_ids(question: str, documents: Mapping[str, str]) -> list[str]:
    """Ids of the documents whose file name (without extension) appears in the question."""
    asked = f" {_normalized(question)} "
    named = []
    for document_id, filename in documents.items():
        stem = _normalized(filename.rsplit(".", 1)[0])
        if stem and f" {stem} " in asked:
            named.append(document_id)
    return named
