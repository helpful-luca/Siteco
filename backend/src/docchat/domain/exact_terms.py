"""Exact term recall next to the hybrid search. Pure functions, no I/O.

Embeddings blur rare words and BM25 on stems misses compounds ("Bemessungslebensdauer" inside
"Lebensdauer" questions and the other way round). Codes (IP66, L90B10, article numbers) and
compounds must be found where they literally occur, so a case-insensitive substring search
runs next to the hybrid search and its hits are merged by weighted reciprocal rank fusion.
"""

import math
import re
from collections.abc import Collection, Sequence

from docchat.domain.models import Chunk
from docchat.domain.page_reference import strip_page_references

_TOKEN = re.compile(r"[0-9A-Za-zÀ-ÿ]+(?:[.\-/,][0-9A-Za-zÀ-ÿ]+)*")
_MIN_LETTERS = 3
_MIN_DIGIT_TERM = 2
_COMPOUND_CHARS = 10
_KEYWORD_QUERY_WORDS = 4
_RRF_K = 60
_LENGTH_NORM = 0.75
_TYPICAL_CHARS = 1600  # one chunk of about 400 tokens
_STOP_TEXT = """
der die das den dem des ein eine einer einem einen eines und oder ist sind war waren hat haben
was wie welche welcher welches welchen wo wann wer wird werden bei mit von vom zu zum zur fuer
für auf aus im an am es gibt mir mich zeig zeige zeigen bitte steht stehen nicht nur auch noch
dass ob als viel viele kann koennen können kannst dir du ich sie wir ihr ueber über unter nach
vor sich sein seine ihre diese dieser dieses gegen ohne wieviel
the and are was what which where when who how does did you your with from show please about
its this that there have has for not can could would should into
"""
_STOP_WORDS = frozenset(_STOP_TEXT.split())


def query_terms(question: str) -> tuple[str, ...]:
    """The words worth looking up literally, lower case, without filler and page numbers."""
    terms: list[str] = []
    for token in _TOKEN.findall(strip_page_references(question).lower()):
        has_digit = any(c.isdigit() for c in token)
        if token in _STOP_WORDS or token in terms:
            continue
        if has_digit and token.isdigit() and len(token) < _MIN_LETTERS:
            continue
        if len(token) < (_MIN_DIGIT_TERM if has_digit else _MIN_LETTERS):
            continue
        terms.append(token)
    return tuple(terms)


def query_phrase(question: str) -> str | None:
    """The whole lookup as one phrase ("fl 31 micro"): short words and numbers carry no weight
    alone but pin a product name down together. None for a single word."""
    words = _TOKEN.findall(strip_page_references(question).lower())
    return " ".join(words) if len(words) > 1 else None


def is_keyword_query(question: str, terms: Sequence[str]) -> bool:
    """A lookup of a few words, not a sentence ("IP66 IK08", "Bemessungslebensdauer"): exact
    hits come first."""
    words = len(_TOKEN.findall(strip_page_references(question)))
    return len(terms) > 0 and words <= _KEYWORD_QUERY_WORDS


def is_rare(term: str) -> bool:
    """A code (has a digit) or a long compound: embeddings and stemming handle these badly."""
    return len(term) >= _COMPOUND_CHARS or any(c.isdigit() for c in term)


def missing_from(chunks: Collection[Chunk], terms: Sequence[str]) -> tuple[str, ...]:
    """The terms that appear in none of the chunks."""
    lowered = [c.text.lower() for c in chunks]
    return tuple(t for t in terms if not any(t in text for text in lowered))


def rank_exact(chunks: Sequence[Chunk], terms: Sequence[str]) -> list[Chunk]:
    """Chunks that contain the terms, best first: BM25 style with rarer terms weighing more,
    short chunks over long ones, and chunks that hold more of the terms over fewer."""
    if not chunks or not terms:
        return list(chunks)
    total = len(chunks)
    lowered = [c.text.lower() for c in chunks]
    weights = {}
    for term in terms:
        df = sum(1 for text in lowered if term in text)
        weights[term] = math.log(1 + (total - df + 0.5) / (df + 0.5)) + 1 if df else 0.0

    def score(text: str) -> float:
        norm = 1 - _LENGTH_NORM + _LENGTH_NORM * len(text) / _TYPICAL_CHARS
        value = 0.0
        for term in terms:
            tf = text.count(term)
            if tf:
                value += weights[term] * tf * 2.2 / (tf + 1.2 * norm)
        return value

    scored = [(score(text), -index) for index, text in enumerate(lowered)]
    order = sorted(range(total), key=lambda i: scored[i], reverse=True)
    return [chunks[i] for i in order]


def fuse(hybrid: Sequence[Chunk], exact: Sequence[Chunk], *, exact_weight: float) -> list[Chunk]:
    """Weighted reciprocal rank fusion. With a weight of 2 or more an exact hit outranks every
    hybrid-only result, which is what a one-word lookup wants; at 1 both lists weigh the same."""
    scores: dict[str, float] = {}
    by_id: dict[str, Chunk] = {}
    for weight, ranking in ((1.0, hybrid), (exact_weight, exact)):
        for rank, chunk in enumerate(ranking, start=1):
            scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + weight / (_RRF_K + rank)
            by_id.setdefault(chunk.chunk_id, chunk)
    return [by_id[i] for i in sorted(scores, key=lambda i: -scores[i])]
