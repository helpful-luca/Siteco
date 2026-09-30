from datetime import UTC, datetime

from docchat.domain.chat_models import Message
from docchat.domain.enums import Lane, MessageRole, MessageStatus
from docchat.domain.history import HistoryTurn, build_history, estimate_tokens

T0 = datetime(2026, 9, 30, tzinfo=UTC)


def q(i: int, text: str | None = None) -> Message:
    return Message(f"u{i}", "c", MessageRole.USER, T0, content=text or f"Frage {i}")


def a(
    i: int,
    status: MessageStatus = MessageStatus.COMPLETE,
    *,
    text: str | None = None,
    lane: Lane = Lane.A,
    preferred: bool = True,
) -> Message:
    return Message(
        f"a{i}{lane.value}",
        "c",
        MessageRole.ASSISTANT,
        T0,
        content=f"Antwort {i}{lane.value}" if text is None else text,
        status=status,
        parent_id=f"u{i}",
        lane=lane,
        is_preferred=preferred,
    )


def test_pairs_questions_with_their_answers_in_order() -> None:
    history = build_history([q(1), a(1), q(2), a(2)], max_turns=6, max_tokens=6000)
    assert history == (HistoryTurn("Frage 1", "Antwort 1a"), HistoryTurn("Frage 2", "Antwort 2a"))


def test_failed_turns_are_dropped_with_their_question_so_roles_alternate() -> None:
    messages = [
        q(1), a(1),
        q(2), a(2, MessageStatus.ERROR),
        q(3), a(3, MessageStatus.STOPPED),
        q(4), a(4, MessageStatus.REFUSED),
        q(5), a(5, MessageStatus.INTERRUPTED),
        q(6), a(6, MessageStatus.SOURCES_ONLY),
        q(7),  # no answer at all
        q(8), a(8, MessageStatus.TRUNCATED),
    ]  # fmt: skip
    history = build_history(messages, max_turns=6, max_tokens=6000)
    assert [t.question for t in history] == ["Frage 1", "Frage 8"]


def test_empty_answers_do_not_count() -> None:
    assert build_history([q(1), a(1, text="  ")], max_turns=6, max_tokens=6000) == ()


def test_only_the_preferred_comparison_answer_goes_into_the_history() -> None:
    messages = [q(1), a(1, lane=Lane.A, preferred=False), a(1, lane=Lane.B, preferred=True)]
    assert build_history(messages, max_turns=6, max_tokens=6000)[0].answer == "Antwort 1b"


def test_keeps_the_last_max_turns() -> None:
    messages = [m for i in range(10) for m in (q(i), a(i))]
    history = build_history(messages, max_turns=6, max_tokens=60_000)
    assert [t.question for t in history] == [f"Frage {i}" for i in range(4, 10)]


def test_token_budget_drops_the_oldest_turns_first() -> None:
    long = "x" * 4000  # about 1000 tokens
    messages = [m for i in range(4) for m in (q(i, long), a(i, text=long))]
    history = build_history(messages, max_turns=6, max_tokens=4500)
    assert len(history) == 2
    assert history[-1].question == long
    assert sum(estimate_tokens(t.question + t.answer) for t in history) <= 4500


def test_a_single_turn_over_budget_is_dropped() -> None:
    assert build_history([q(1, "x" * 400), a(1)], max_turns=6, max_tokens=10) == ()


def test_zero_turns_disables_history() -> None:
    assert build_history([q(1), a(1)], max_turns=0, max_tokens=6000) == ()
