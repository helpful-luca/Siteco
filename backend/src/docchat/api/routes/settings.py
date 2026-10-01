"""App settings that are not preferences: the Claude API key."""

from typing import Any

from fastapi import APIRouter

from docchat.api.dependencies import ContainerDep
from docchat.api.schemas.common import ErrorEnvelope
from docchat.api.schemas.settings import ApiKeyIn, ApiKeyOut

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {status: {"model": ErrorEnvelope} for status in (*statuses, 422)}


@router.get("/api-key", response_model=ApiKeyOut)
def get_api_key(container: ContainerDep) -> ApiKeyOut:
    """Whether a key is set, where it comes from and how it was checked. Never the key."""
    return ApiKeyOut.from_state(container.api_keys.state())


@router.put("/api-key", response_model=ApiKeyOut, responses=_errors())
async def put_api_key(body: ApiKeyIn, container: ContainerDep) -> ApiKeyOut:
    """Checks the key with a free call, then stores it on this machine and uses it from the
    next question on. 422 `API_KEY_INVALID` when Anthropic refuses it (nothing is stored)."""
    return ApiKeyOut.from_state(await container.api_keys.save(body.key))


@router.delete("/api-key", response_model=ApiKeyOut)
def delete_api_key(container: ContainerDep) -> ApiKeyOut:
    """Forgets the key from Settings; ANTHROPIC_API_KEY applies again if it is set."""
    return ApiKeyOut.from_state(container.api_keys.delete())
