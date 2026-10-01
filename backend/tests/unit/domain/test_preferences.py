import pytest

from docchat.domain.enums import AnswerStyle, Effort, Locale, Theme
from docchat.domain.preferences import NAME_MAX_CHARS, clean_name, default_preferences


def test_defaults_are_not_onboarded_and_use_the_default_model() -> None:
    prefs = default_preferences("claude-sonnet-5-5")
    assert prefs.onboarded is False
    assert prefs.default_model == "claude-sonnet-5-5"
    assert prefs.locale is Locale.DE
    assert prefs.theme is Theme.SYSTEM
    assert prefs.effort is Effort.LOW
    assert prefs.style is AnswerStyle.CONCISE
    assert prefs.name == ""
    assert len(prefs.compare_models) == 2
    assert prefs.compare_models[0] != prefs.compare_models[1]


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("  Anna  ", "Anna"),
        ("An\u0000na", "Anna"),
        ("Anna\u202eMaria", "AnnaMaria"),  # bidi override
        ("Zero\u200bWidth", "ZeroWidth"),
        ("Jean  \t Luc", "Jean Luc"),
        ("\n\r", ""),
        ("<script>alert(1)</script>", "<script>alert(1)</script>"),  # rendered as text only
        ("Zoë", "Zoë"),
        ("\U0001f468\u200d\U0001f469", "\U0001f468\u200d\U0001f469"),  # emoji sequence stays
    ],
)
def test_clean_name(raw: str, clean: str) -> None:
    assert clean_name(raw) == clean


def test_clean_name_caps_length_without_splitting_a_combining_mark() -> None:
    assert len(clean_name("x" * 60)) == NAME_MAX_CHARS
    name = "a" * (NAME_MAX_CHARS - 1) + "e\u0301"  # e plus combining acute at the edge
    cleaned = clean_name(name)
    assert not cleaned.endswith("e")
    assert len(cleaned) <= NAME_MAX_CHARS
