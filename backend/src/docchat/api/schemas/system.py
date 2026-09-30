from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from docchat.domain.enums import ComponentStatus, Effort, LlmStatus
from docchat.domain.model_profiles import ModelProfile


class LiveOut(BaseModel):
    app: str
    status: Literal["ok"]


class ReadyChecks(BaseModel):
    db: Literal["ok", "failed"]
    vector_store: ComponentStatus
    embedding_model: ComponentStatus
    llm: LlmStatus


class ReadyOut(BaseModel):
    ready: bool
    checks: ReadyChecks


class Features(BaseModel):
    retrieval_only: bool
    malware_scan: Literal["required", "off"]


class Limits(BaseModel):
    """Known to the UI so it can reject files and questions before sending them."""

    max_upload_mb: int
    max_pdf_pages: int
    max_storage_mb: int
    max_question_chars: int
    chat_per_minute: int = Field(description="Own limit for questions; 0 is off.")
    uploads_per_minute: int = Field(description="Own limit for uploads; 0 is off.")
    max_concurrent_answers: int
    daily_budget_usd: float | None = Field(description="Optional cost brake; null is off.")


class BudgetOut(BaseModel):
    """Only present with DAILY_BUDGET_USD. Resets at midnight UTC."""

    limit_usd: float
    spent_usd: float
    exceeded: bool
    reset_time: datetime


class ModelInfo(BaseModel):
    id: str
    label: str
    tier: str
    input_usd_per_mtok: float
    output_usd_per_mtok: float
    cache_read_usd_per_mtok: float
    efforts: list[Effort]
    default_effort: Effort | None
    available: bool

    @classmethod
    def from_profile(cls, profile: ModelProfile, *, available: bool) -> "ModelInfo":
        return cls(
            id=profile.id,
            label=profile.label,
            tier=profile.tier,
            input_usd_per_mtok=profile.prices.input,
            output_usd_per_mtok=profile.prices.output,
            cache_read_usd_per_mtok=profile.prices.cache_read,
            efforts=list(profile.efforts),
            default_effort=profile.default_effort,
            available=available,
        )


class ConfigOut(BaseModel):
    version: str
    commit: str
    llm_status: LlmStatus
    limits: Limits
    budget: BudgetOut | None
    features: Features
    models: list[ModelInfo]
    default_model: str
