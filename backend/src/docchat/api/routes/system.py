from fastapi import APIRouter
from fastapi.responses import JSONResponse

from docchat.api.dependencies import ContainerDep
from docchat.api.schemas.system import ConfigOut, Features, LiveOut, ReadyChecks, ReadyOut
from docchat.domain.enums import ComponentStatus, LlmStatus

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
        embedding_model=container.embedder_status,
        llm=container.llm_status,
    )
    is_ready = checks.db == "ok" and checks.embedding_model == ComponentStatus.OK
    body = ReadyOut(ready=is_ready, checks=checks)
    return JSONResponse(body.model_dump(mode="json"), status_code=200 if is_ready else 503)


@router.get("/config", response_model=ConfigOut)
def config(container: ContainerDep) -> ConfigOut:
    settings = container.settings
    return ConfigOut(
        version=settings.app_version,
        commit=settings.git_sha,
        llm_status=container.llm_status,
        features=Features(retrieval_only=container.llm_status == LlmStatus.MISSING_KEY),
    )
