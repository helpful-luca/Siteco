"""What we know about the Claude API key. Shared by the answer service and `/api/config`."""

from docchat.domain.enums import LlmStatus


class LlmHealth:
    def __init__(self, status: LlmStatus) -> None:
        self.status = status

    @property
    def available(self) -> bool:
        """False without a key or after the key was rejected: answers are retrieval-only."""
        return self.status not in (LlmStatus.MISSING_KEY, LlmStatus.INVALID_KEY)

    def mark_ok(self) -> None:
        if self.status is LlmStatus.UNCHECKED:
            self.status = LlmStatus.OK

    def mark_invalid(self) -> None:
        self.status = LlmStatus.INVALID_KEY
