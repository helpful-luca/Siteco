"""How many tokens the documents of a scope may take in full-context mode. Pure functions.

The limit is the configured budget, but never more than the model can take: its context
window minus the answer and a margin for system prompt, history and question. Without the
token counting API the size is estimated with a conservative ratio, because German compounds
and catalog tables cost more tokens than the usual four characters per token.
"""

import math

from docchat.domain.model_profiles import MODEL_PROFILES

CONSERVATIVE_CHARS_PER_TOKEN = 2.5
UNKNOWN_MODEL_WINDOW = 200_000


def conservative_tokens(chars: int) -> int:
    return math.ceil(chars / CONSERVATIVE_CHARS_PER_TOKEN)


def full_context_limit(
    *, configured: int, model: str, max_output_tokens: int, history_margin: int
) -> int:
    """Tokens the documents may take for this model; 0 or less means no full-context mode."""
    profile = MODEL_PROFILES.get(model)
    window = profile.context_window if profile else UNKNOWN_MODEL_WINDOW
    return min(configured, window - max_output_tokens - history_margin)
