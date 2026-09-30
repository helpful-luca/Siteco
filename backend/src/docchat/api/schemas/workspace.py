from pydantic import BaseModel, ConfigDict, Field

from docchat.domain.enums import AnswerStyle, Effort, Locale, Theme
from docchat.domain.preferences import NAME_MAX_CHARS, Preferences
from docchat.services.workspace_service import WorkspaceStats


class PreferencesBody(BaseModel):
    """Always the whole object (annex 11, 3.2)."""

    model_config = ConfigDict(extra="forbid")

    locale: Locale
    theme: Theme
    name: str = Field(
        max_length=NAME_MAX_CHARS,
        description="Only for the greeting, never sent to the model. Cleaned on save.",
    )
    default_model: str = Field(max_length=100)
    effort: Effort = Field(description="Answer mode: fast (low), balanced, thorough (high).")
    style: AnswerStyle
    compare_models: list[str] = Field(min_length=2, max_length=2)
    onboarded: bool

    def to_domain(self) -> Preferences:
        first, second = self.compare_models
        return Preferences(
            locale=self.locale,
            theme=self.theme,
            name=self.name,
            default_model=self.default_model,
            effort=self.effort,
            style=self.style,
            compare_models=(first, second),
            onboarded=self.onboarded,
        )

    @classmethod
    def from_domain(cls, prefs: Preferences) -> "PreferencesBody":
        return cls(
            locale=prefs.locale,
            theme=prefs.theme,
            name=prefs.name,
            default_model=prefs.default_model,
            effort=prefs.effort,
            style=prefs.style,
            compare_models=list(prefs.compare_models),
            onboarded=prefs.onboarded,
        )


class WorkspaceStatsOut(BaseModel):
    documents: int
    chats: int
    documents_bytes: int = Field(description="Size of the original files.")
    storage_bytes: int = Field(description="Everything on disk: files, search index, database.")


class UsageTodayOut(BaseModel):
    cost_usd: float
    requests: int
    input_tokens: int
    output_tokens: int
    budget_usd: float | None = Field(description="DAILY_BUDGET_USD; null is off.")


class WorkspaceOut(BaseModel):
    stats: WorkspaceStatsOut
    usage_today: UsageTodayOut = Field(description="The current UTC day.")
    retention_days: int | None = Field(description="RETENTION_DAYS; null: nothing is deleted.")

    @classmethod
    def from_stats(cls, stats: WorkspaceStats) -> "WorkspaceOut":
        usage = stats.usage_today
        return cls(
            stats=WorkspaceStatsOut(
                documents=stats.documents,
                chats=stats.chats,
                documents_bytes=stats.documents_bytes,
                storage_bytes=stats.storage_bytes,
            ),
            usage_today=UsageTodayOut(
                cost_usd=usage.cost_usd,
                requests=usage.requests,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                budget_usd=stats.budget_usd,
            ),
            retention_days=stats.retention_days,
        )
