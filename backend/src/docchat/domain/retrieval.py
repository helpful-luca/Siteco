"""Rules for choosing what the model gets to read. Pure functions, no I/O."""

import hashlib
import re
from collections.abc import Iterable, Sequence

from docchat.domain.context_budget import conservative_tokens
from docchat.domain.models import Chunk

SNIPPET_CHARS = 240
# "Summarize the catalog" needs the whole document; above the full-context limit we can only
# answer from the most relevant passages and say so (notice SUMMARY_PARTIAL).
_SUMMARY = re.compile(
    r"zusammenfass|fasse\b|fass\b|überblick|ueberblick|gesamtüberblick|"
    r"summar|overview|outline|tl;?dr",
    re.IGNORECASE,
)
_SPACE = re.compile(r"\s+")


def follow_up_query(previous_question: str | None, question: str) -> str:
    """Follow-ups search with the previous question too, so "And the power?" still finds the
    product of the previous turn. Deterministic and needs no model call."""
    if not previous_question:
        return question
    return f"{previous_question}\n{question}"


def is_summary_request(question: str) -> bool:
    return _SUMMARY.search(question) is not None


def fits_full_context(char_counts: Iterable[int], max_tokens: int) -> bool:
    """True if all documents together may fit the full-context budget. 0 turns the mode off.

    Conservative like the budget check before the request: a scope that looks too large goes
    straight to search, without a token count or a failed try.
    """
    if max_tokens <= 0:
        return False
    return sum(conservative_tokens(c) for c in char_counts) <= max_tokens


def _fingerprint(text: str) -> str:
    normalized = _SPACE.sub(" ", text).strip().casefold()
    return hashlib.sha1(normalized.encode("utf-8"), usedforsecurity=False).hexdigest()


def select_sources(
    ranked: Sequence[Chunk], *, top_k: int, per_document_cap: int, multiple_documents: bool
) -> list[Chunk]:
    """Best `top_k` chunks in rank order, without duplicate texts (repeated headers, the same
    paragraph in two datasheets). With several documents in scope one long document may take
    at most `per_document_cap` places, so comparisons see every document."""
    selected: list[Chunk] = []
    seen: set[str] = set()
    per_document: dict[str, int] = {}
    for chunk in ranked:
        if len(selected) >= top_k:
            break
        fingerprint = _fingerprint(chunk.text)
        if fingerprint in seen:
            continue
        if multiple_documents and per_document.get(chunk.document_id, 0) >= per_document_cap:
            continue
        seen.add(fingerprint)
        per_document[chunk.document_id] = per_document.get(chunk.document_id, 0) + 1
        selected.append(chunk)
    return selected


def snippet(text: str, max_chars: int = SNIPPET_CHARS) -> str:
    """A one-line preview of a chunk for the source list."""
    line = _SPACE.sub(" ", text).strip()
    if len(line) <= max_chars:
        return line
    cut = line[: max_chars - 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > max_chars // 2 else cut) + "…"
