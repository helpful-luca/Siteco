"""Chat titles come from the first question. No model call: free, instant, works without key."""

import re

TITLE_MAX_CHARS = 60
_MIN_WORD_CUT = 20  # below this, cutting at a word boundary would lose too much
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_TRAILING = " ,.;:!?"


def title_from_question(question: str) -> str:
    """One line, at most 60 characters, cut at a word boundary with an ellipsis."""
    text = " ".join(_CONTROL.sub(" ", question).split())
    if len(text) <= TITLE_MAX_CHARS:
        return text
    limit = TITLE_MAX_CHARS - 1  # room for the ellipsis
    head = text[: limit + 1]
    space = head.rfind(" ")
    head = head[:space] if space >= _MIN_WORD_CUT else text[:limit]
    return head.rstrip(_TRAILING) + "…"
