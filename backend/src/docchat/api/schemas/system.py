from typing import Literal

from pydantic import BaseModel

from docchat.domain.enums import ComponentStatus, LlmStatus


class LiveOut(BaseModel):
    app: str
    status: Literal["ok"]


class ReadyChecks(BaseModel):
    db: Literal["ok", "failed"]
    embedding_model: ComponentStatus
    llm: LlmStatus


class ReadyOut(BaseModel):
    ready: bool
    checks: ReadyChecks


class Features(BaseModel):
    retrieval_only: bool


class ConfigOut(BaseModel):
    version: str
    commit: str
    llm_status: LlmStatus
    features: Features
