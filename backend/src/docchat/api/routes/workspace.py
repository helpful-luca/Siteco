"""Preferences and the workspace as a whole."""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from docchat.api.dependencies import ContainerDep
from docchat.api.schemas.common import ErrorEnvelope
from docchat.api.schemas.workspace import PreferencesBody, WorkspaceOut

router = APIRouter(prefix="/api", tags=["workspace"])


def _errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {status: {"model": ErrorEnvelope} for status in (*statuses, 422)}


@router.get("/preferences", response_model=PreferencesBody)
def get_preferences(container: ContainerDep) -> PreferencesBody:
    """The defaults (`onboarded` false) until the setup ran."""
    return PreferencesBody.from_domain(container.preferences.get())


@router.put("/preferences", response_model=PreferencesBody, responses=_errors())
def put_preferences(body: PreferencesBody, container: ContainerDep) -> PreferencesBody:
    """The whole object. 422 `MODEL_NOT_ALLOWED` for a model that is not offered."""
    return PreferencesBody.from_domain(container.preferences.update(body.to_domain()))


@router.get("/workspace", response_model=WorkspaceOut)
async def get_workspace(container: ContainerDep) -> WorkspaceOut:
    return WorkspaceOut.from_stats(await container.workspace.stats())


@router.delete("/workspace", status_code=204, responses=_errors(500))
async def delete_workspace(
    container: ContainerDep,
    reset_preferences: Annotated[
        bool, Query(description="Also forget name and settings; the setup shows again.")
    ] = False,
) -> Response:
    """Deletes every document, chat and message. Running answers are stopped first."""
    await container.workspace.wipe(reset_preferences=reset_preferences)
    return Response(status_code=204)


@router.get(
    "/workspace/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_workspace(container: ContainerDep) -> StreamingResponse:
    """ZIP with every chat (JSON and Markdown), the preferences and the document list."""
    export = container.export
    chunks, file = await export.build()
    return StreamingResponse(
        chunks,
        background=BackgroundTask(file.close),  # also after an aborted download
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{export.filename()}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
