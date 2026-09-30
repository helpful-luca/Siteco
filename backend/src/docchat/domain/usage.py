"""Token usage of one model call, as reported by the provider."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0

    def __add__(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cache_read_input_tokens + other.cache_read_input_tokens,
            self.cache_creation_input_tokens + other.cache_creation_input_tokens,
        )


@dataclass(frozen=True)
class ModelUsage:
    """Usage of one attempt and the model that ran it. With server-side fallbacks one answer
    can have several (the declined model and the one that served it)."""

    model: str
    usage: TokenUsage


def total_usage(parts: tuple[ModelUsage, ...]) -> TokenUsage:
    total = TokenUsage()
    for part in parts:
        total += part.usage
    return total


@dataclass(frozen=True)
class UsageDay:
    """Cost and tokens of one UTC day, across all chats (also deleted ones)."""

    cost_usd: float
    requests: int
    input_tokens: int
    output_tokens: int
