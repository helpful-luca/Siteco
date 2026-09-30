"""The conversation history sent to the model: plain text turns, strictly alternating.

Only answered turns count (`complete` or `truncated`); a question without such an answer is
dropped together with it, so user and assistant roles always alternate (the API rejects
anything else). Thinking blocks and earlier search results never go back to the model.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from docchat.domain.chat_models import Message
from docchat.domain.enums import MessageRole, MessageStatus

HISTORY_STATUSES = frozenset({MessageStatus.COMPLETE, MessageStatus.TRUNCATED})


@dataclass(frozen=True)
class HistoryTurn:
    question: str
    answer: str


def estimate_tokens(text: str) -> int:
    """About four characters per token. No extra round trip for exact counting."""
    return (len(text) + 3) // 4


def _answer_for(question: Message, answers: Sequence[Message]) -> Message | None:
    usable = [
        a
        for a in answers
        if a.parent_id == question.id and a.status in HISTORY_STATUSES and a.content.strip()
    ]
    preferred = [a for a in usable if a.is_preferred]
    candidates = preferred or usable
    return candidates[0] if candidates else None


def build_history(
    messages: Sequence[Message], *, max_turns: int, max_tokens: int
) -> tuple[HistoryTurn, ...]:
    """The last `max_turns` answered turns within `max_tokens`, oldest dropped first."""
    questions = [m for m in messages if m.role is MessageRole.USER]
    answers = [m for m in messages if m.role is MessageRole.ASSISTANT]
    turns: list[HistoryTurn] = []
    for question in questions:
        answer = _answer_for(question, answers)
        if answer is not None:
            turns.append(HistoryTurn(question.content, answer.content))
    turns = turns[-max_turns:] if max_turns > 0 else []
    while turns and sum(estimate_tokens(t.question + t.answer) for t in turns) > max_tokens:
        turns.pop(0)
    return tuple(turns)
