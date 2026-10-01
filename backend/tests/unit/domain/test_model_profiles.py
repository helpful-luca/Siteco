import pytest

from docchat.domain.enums import Effort
from docchat.domain.model_profiles import MODEL_PROFILES, cost_usd, prices_for, resolve_effort
from docchat.domain.usage import ModelUsage, TokenUsage


def test_the_three_models_are_known() -> None:
    assert set(MODEL_PROFILES) == {"claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"}


def test_haiku_takes_no_effort_and_no_fallbacks() -> None:
    haiku = MODEL_PROFILES["claude-haiku-4-5"]
    assert haiku.efforts == ()
    assert resolve_effort(haiku, Effort.HIGH) is None
    assert not haiku.supports_fallbacks
    assert not haiku.supports_between_tools


@pytest.mark.parametrize("model", ["claude-sonnet-5-5", "claude-opus-5-5"])
def test_five_five_models_default_to_low_effort(model: str) -> None:
    profile = MODEL_PROFILES[model]
    assert resolve_effort(profile, None) is Effort.LOW
    assert resolve_effort(profile, Effort.HIGH) is Effort.HIGH
    assert profile.supports_fallbacks


def test_between_tools_is_sonnet_only() -> None:
    assert [m for m, p in MODEL_PROFILES.items() if p.supports_between_tools] == [
        "claude-sonnet-5-5"
    ]


def test_cost_uses_input_output_and_cache_prices() -> None:
    usage = TokenUsage(
        input_tokens=412,
        output_tokens=96,
        cache_read_input_tokens=1650,
        cache_creation_input_tokens=100,
    )
    cost = cost_usd([ModelUsage("claude-sonnet-5-5", usage)], requested_model="claude-sonnet-5-5")
    expected = (412 * 2.0 + 96 * 10.0 + 1650 * 0.2 + 100 * 2.5) / 1_000_000
    assert cost == pytest.approx(expected)


def test_cost_prices_each_attempt_at_the_model_that_ran_it() -> None:
    declined = ModelUsage("claude-opus-5-5", TokenUsage(input_tokens=1000, output_tokens=10))
    served = ModelUsage("claude-opus-4-8", TokenUsage(input_tokens=1000, output_tokens=100))
    cost = cost_usd([declined, served], requested_model="claude-opus-5-5")
    expected = (1000 * 4 + 10 * 20) / 1e6 + (1000 * 5 + 100 * 25) / 1e6
    assert cost == pytest.approx(expected)


def test_unknown_models_are_estimated_at_the_requested_price() -> None:
    assert prices_for("claude-future-9") is None
    part = ModelUsage("claude-future-9", TokenUsage(input_tokens=1_000_000))
    assert cost_usd([part], requested_model="claude-haiku-4-5") == pytest.approx(1.0)


def test_model_alias_drops_only_a_date_suffix() -> None:
    from docchat.domain.model_profiles import model_alias

    assert model_alias("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    assert model_alias("claude-sonnet-5-5") == "claude-sonnet-5-5"
    assert model_alias("claude-sonnet-5") == "claude-sonnet-5"  # a version, not a date
