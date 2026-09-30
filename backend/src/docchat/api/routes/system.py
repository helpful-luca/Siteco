from fastapi import APIRouter

from docchat.api.schemas.system import LiveOut

router = APIRouter(prefix="/api", tags=["system"])

APP_ID = "siteco-docchat"


@router.get("/health/live", response_model=LiveOut)
def live() -> LiveOut:
    return LiveOut(app=APP_ID, status="ok")
