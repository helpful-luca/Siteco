"""What each Claude model accepts, and what it costs.

Every model gets its own request rules: sending one body blindly to another model is an
immediate 400 (annex 12, 1a point 4). There is no pricing API, so prices are constants with
their source and date.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from docchat.domain.enums import Effort
from docchat.domain.usage import ModelUsage

PRICES_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing"
PRICES_AS_OF = "2026-09-30"
_MTOK = 1_000_000


@dataclass(frozen=True)
class Prices:
    """USD per million tokens. Cache writes are 5-minute writes (1.25x input)."""

    input: float
    output: float
    cache_read: float
    cache_write: float


@dataclass(frozen=True)
class ModelProfile:
    id: str
    label: str
    tier: str  # fast, balanced, strongest
    prices: Prices
    # Effort levels the model takes in `output_config.effort`. Empty: never send effort.
    efforts: tuple[Effort, ...]
    default_effort: Effort | None
    # `thinking: {"type": "between_tools"}` is Sonnet 5.5 only; any other model answers 400.
    supports_between_tools: bool
    # Server-side refusal fallbacks (`fallbacks: "default"`).
    supports_fallbacks: bool
    context_window: int  # input tokens the model accepts (Models API `max_input_tokens`)


_EFFORTS = (Effort.LOW, Effort.MEDIUM, Effort.HIGH)

MODEL_PROFILES: dict[str, ModelProfile] = {
    p.id: p
    for p in (
        ModelProfile(
            id="claude-haiku-4-5",
            label="Claude Haiku 4.5",
            tier="fast",
            prices=Prices(input=1.0, output=5.0, cache_read=0.10, cache_write=1.25),
            efforts=(),
            default_effort=None,
            supports_between_tools=False,
            supports_fallbacks=False,
            context_window=200_000,
        ),
        ModelProfile(
            id="claude-sonnet-5-5",
            label="Claude Sonnet 5.5",
            tier="balanced",
            prices=Prices(input=2.0, output=10.0, cache_read=0.20, cache_write=2.50),
            efforts=_EFFORTS,
            default_effort=Effort.LOW,
            supports_between_tools=True,
            supports_fallbacks=True,
            context_window=1_000_000,
        ),
        ModelProfile(
            id="claude-opus-5-5",
            label="Claude Opus 5.5",
            tier="strongest",
            prices=Prices(input=4.0, output=20.0, cache_read=0.20, cache_write=5.0),
            efforts=_EFFORTS,
            default_effort=Effort.LOW,
            supports_between_tools=False,
            supports_fallbacks=True,
            context_window=1_000_000,
        ),
    )
}

# Models a server-side fallback may answer with. They are not selectable, but their tokens
# must be priced at their own rates.
FALLBACK_PRICES: dict[str, Prices] = {
    "claude-sonnet-5": Prices(input=2.0, output=10.0, cache_read=0.20, cache_write=2.50),
    "claude-opus-5": Prices(input=5.0, output=25.0, cache_read=0.50, cache_write=6.25),
    "claude-opus-4-8": Prices(input=5.0, output=25.0, cache_read=0.50, cache_write=6.25),
}


_DATE_SUFFIX = re.compile(r"-\d{8}$")


def model_alias(model: str) -> str:
    """The API names the model it served with a date ("claude-haiku-4-5-20251001"); the alias
    without it is the same model, the one we requested and price."""
    return _DATE_SUFFIX.sub("", model)


def prices_for(model: str) -> Prices | None:
    alias = model_alias(model)
    profile = MODEL_PROFILES.get(alias)
    return profile.prices if profile else FALLBACK_PRICES.get(alias)


def resolve_effort(profile: ModelProfile, requested: Effort | None) -> Effort | None:
    """The effort to send: none for models without effort, the default when not given."""
    if not profile.efforts:
        return None
    if requested in profile.efforts:
        return requested
    return profile.default_effort


def cost_usd(parts: Sequence[ModelUsage], *, requested_model: str) -> float:
    """Each attempt at the price of the model that ran it. Unknown models are estimated at the
    requested model's price, so a new fallback target never shows as free."""
    total = 0.0
    for part in parts:
        prices = prices_for(part.model) or prices_for(requested_model)
        if prices is None:
            continue
        u = part.usage
        total += (
            u.input_tokens * prices.input
            + u.output_tokens * prices.output
            + u.cache_read_input_tokens * prices.cache_read
            + u.cache_creation_input_tokens * prices.cache_write
        ) / _MTOK
    return round(total, 6)
