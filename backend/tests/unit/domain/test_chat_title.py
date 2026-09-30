import pytest

from docchat.domain.chat_title import TITLE_MAX_CHARS, title_from_question


def test_short_question_is_the_title() -> None:
    assert title_from_question("Welche Schutzart hat die Mira?") == "Welche Schutzart hat die Mira?"


def test_newlines_and_control_characters_become_single_spaces() -> None:
    assert title_from_question("  Erste Zeile\n\nzweite\tZeile\x07 ") == "Erste Zeile zweite Zeile"


def test_long_question_is_cut_at_a_word_boundary_with_ellipsis() -> None:
    question = "Welche Leuchten aus dem Katalog eignen sich für Straßen mit hoher Verkehrsdichte?"
    title = title_from_question(question)
    assert len(title) <= TITLE_MAX_CHARS
    assert title.endswith("…")
    assert question.startswith(title[:-1])
    assert title[-2] != " "
    assert question[len(title) - 1] == " "  # the cut is at a word boundary


def test_one_long_word_is_cut_hard() -> None:
    title = title_from_question("x" * 200)
    assert title == "x" * (TITLE_MAX_CHARS - 1) + "…"


@pytest.mark.parametrize("text", ["", "   ", "\n"])
def test_blank_question_gives_empty_title(text: str) -> None:
    assert title_from_question(text) == ""
