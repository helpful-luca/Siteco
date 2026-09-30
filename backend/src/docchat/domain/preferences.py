"""The user's preferences: one row per workspace, the truth for browser and desktop window.

The name is only used to greet the user. It never reaches the model (annex 11, 5.4)."""

import re
import unicodedata
from dataclasses import dataclass

from docchat.domain.enums import AnswerStyle, Effort, Locale, Theme

NAME_MAX_CHARS = 40
DEFAULT_COMPARE_MODELS = ("claude-sonnet-5-5", "claude-haiku-4-5")

# C0 and C1 controls, zero width and bidi controls, word joiners, the BOM.
_INVISIBLE = re.compile(
    r"[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]"
)


@dataclass(frozen=True)
class Preferences:
    locale: Locale
    theme: Theme
    name: str
    default_model: str
    effort: Effort
    style: AnswerStyle
    compare_models: tuple[str, str]
    onboarded: bool


def default_preferences(default_model: str) -> Preferences:
    """Before the setup ran. The UI keeps the browser's language and the system theme until
    the user chose (`onboarded` false)."""
    compare = DEFAULT_COMPARE_MODELS
    if default_model in compare:
        other = next(m for m in compare if m != default_model)
        compare = (default_model, other)
    return Preferences(
        locale=Locale.DE,
        theme=Theme.SYSTEM,
        name="",
        default_model=default_model,
        effort=Effort.LOW,
        style=AnswerStyle.CONCISE,
        compare_models=compare,
        onboarded=False,
    )


def clean_name(raw: str) -> str:
    """Invisible and control characters removed, whitespace collapsed, at most 40 characters.
    The cut never leaves a base letter without its combining mark."""
    name = " ".join(_INVISIBLE.sub("", unicodedata.normalize("NFC", raw)).split())
    if len(name) <= NAME_MAX_CHARS:
        return name
    cut = NAME_MAX_CHARS
    while cut > 0 and unicodedata.combining(name[cut]):
        cut -= 1  # step back to the base letter, which then goes with its marks
    return name[:cut].rstrip()
