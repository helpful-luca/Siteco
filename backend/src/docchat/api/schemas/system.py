from typing import Literal

from pydantic import BaseModel

from docchat.domain.enums import ComponentStatus, LlmStatus


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
    """Known to the UI so it can reject files before uploading them."""

    max_upload_mb: int
    max_pdf_pages: int
    max_storage_mb: int


class ConfigOut(BaseModel):
    version: str
    commit: str
    llm_status: LlmStatus
    limits: Limits
    features: Features
