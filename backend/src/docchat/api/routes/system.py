from fastapi import APIRouter
from fastapi.responses import JSONResponse

from docchat.api.dependencies import ContainerDep
from docchat.api.schemas.system import (
    BudgetOut,
    ConfigOut,
    Features,
    Limits,
    LiveOut,
    ModelInfo,
    ReadyChecks,
    ReadyOut,
)
from docchat.domain.enums import ComponentStatus
from docchat.domain.model_profiles import MODEL_PROFILES

router = APIRouter(prefix="/api", tags=["system"])

APP_ID = "siteco-docchat"


@router.get("/health/live", response_model=LiveOut)
def live() -> LiveOut:
    """No dependencies. Electron uses `app` to verify it talks to this application."""
    return LiveOut(app=APP_ID, status="ok")


@router.get("/health/ready", response_model=ReadyOut, responses={503: {"model": ReadyOut}})
def ready(container: ContainerDep) -> JSONResponse:
    """Ready means search works. A missing API key does not block readiness."""
    checks = ReadyChecks(
        db="ok" if container.database.ping() else "failed",
        vector_store=container.vector_store_status,
        embedding_model=container.embedder_status,
        llm=container.llm_status,
    )
    is_ready = (
        checks.db == "ok"
        and checks.vector_store == ComponentStatus.OK
        and checks.embedding_model == ComponentStatus.OK
    )
    body = ReadyOut(ready=is_ready, checks=checks)
    return JSONResponse(body.model_dump(mode="json"), status_code=200 if is_ready else 503)


@router.get("/config", response_model=ConfigOut)
def config(container: ContainerDep) -> ConfigOut:
    """Loaded at start. The UI loads it again when an answer reveals a change: a rejected key
    (`llm_status`), a model Claude does not know (`available`), the budget."""
    settings = container.settings
    budget = container.budget.status()
    return ConfigOut(
        version=settings.app_version,
        commit=settings.git_sha,
        llm_status=container.llm_status,
        limits=Limits(
            max_upload_mb=settings.max_upload_mb,
            max_pdf_pages=settings.max_pdf_pages,
            max_storage_mb=settings.max_storage_mb,
            max_question_chars=settings.max_question_chars,
            chat_per_minute=settings.rate_chat_per_min,
            uploads_per_minute=settings.rate_upload_per_min,
            max_concurrent_answers=settings.max_concurrent_streams,
            daily_budget_usd=settings.daily_budget_usd,
        ),
        budget=None
        if budget is None
        else BudgetOut(
            limit_usd=budget.limit_usd,
            spent_usd=round(budget.spent_usd, 6),
            exceeded=budget.exceeded,
            reset_time=budget.reset_at,
        ),
        features=Features(
            retrieval_only=not container.llm_health.available,
            malware_scan=settings.malware_scan,
        ),
        models=[
            ModelInfo.from_profile(p, available=container.models.is_available(p.id))
            for p in MODEL_PROFILES.values()
        ],
        default_model=settings.default_model,
    )
