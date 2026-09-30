"""Models Claude does not know are unavailable for a while, then tried again."""

from docchat.services.model_availability import UNAVAILABLE_FOR_S, ModelAvailability
from tests.fakes import FakeTicker

MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5")


def test_a_gone_model_comes_back_after_the_pause() -> None:
    ticker = FakeTicker()
    models = ModelAvailability(MODELS, "claude-sonnet-5-5", ticker)
    models.mark_unavailable("claude-sonnet-5-5")
    assert models.is_available("claude-sonnet-5-5") is False
    assert models.fallback("claude-sonnet-5-5") == "claude-haiku-4-5"
    ticker.advance(UNAVAILABLE_FOR_S - 1)
    assert models.is_available("claude-sonnet-5-5") is False
    ticker.advance(1)
    assert models.is_available("claude-sonnet-5-5") is True


def test_disabled_models_are_never_available() -> None:
    models = ModelAvailability(("claude-haiku-4-5",), "claude-haiku-4-5", FakeTicker())
    assert models.is_available("claude-opus-5-5") is False
    assert models.fallback("claude-haiku-4-5") is None
