from pydantic import BaseModel, ConfigDict, Field

from docchat.domain.api_key import KeySource, KeyState
from docchat.domain.enums import LlmStatus


class ApiKeyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(max_length=600, description="Never returned, never logged.")


class ApiKeyOut(BaseModel):
    """What the UI may know about the key: never the key, only its last four characters."""

    configured: bool
    source: KeySource | None = Field(description="settings wins over env (ANTHROPIC_API_KEY).")
    suffix: str | None = Field(description="The last four characters, for recognizing it.")
    status: LlmStatus

    @classmethod
    def from_state(cls, state: KeyState) -> "ApiKeyOut":
        return cls(
            configured=state.configured,
            source=state.source,
            suffix=state.suffix,
            status=state.status,
        )
