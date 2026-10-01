"""Library endpoints. Only translation between HTTP and the document services."""

from collections.abc import AsyncIterator
from typing import Annotated, Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from starlette.requests import ClientDisconnect

from docchat.api.dependencies import ContainerDep, DocumentServiceDep, UploadServiceDep
from docchat.api.range_header import check_range
from docchat.api.schemas.common import ErrorEnvelope
from docchat.api.schemas.documents import (
    ChunkOut,
    DocumentEnvelopeOut,
    DocumentListOut,
    DocumentOut,
    ImportEnvelopeOut,
    ImportOut,
    ImportUrlIn,
)
from docchat.domain.enums import DocumentKind
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.url_import_service import ImportJob

router = APIRouter(prefix="/api/documents", tags=["documents"])

_MEDIA_TYPES = {
    DocumentKind.PDF: "application/pdf",
    # Markdown is served as plain text, never as HTML.
    DocumentKind.TXT: "text/plain; charset=utf-8",
    DocumentKind.MD: "text/plain; charset=utf-8",
    # HTML too: the original is shown as source, never rendered (and the sandbox CSP holds).
    DocumentKind.HTML: "text/plain; charset=utf-8",
}
_FILE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=3600",
}
_UPLOAD_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
    }
}


def _errors(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """Documents the envelope. 422 is always listed: FastAPI's default 422 body never occurs."""
    return {status: {"model": ErrorEnvelope} for status in (*statuses, 422)}


async def _body(request: Request) -> AsyncIterator[bytes]:
    try:
        async for data in request.stream():
            yield data
    except ClientDisconnect as exc:
        raise AppError(ErrorCode.UPLOAD_INCOMPLETE) from exc


def _header_error(name: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        details=[{"loc": ["header", name], "type": "value_error"}],
    )


@router.post(
    "",
    status_code=202,
    response_model=DocumentEnvelopeOut,
    openapi_extra=_UPLOAD_BODY,
    responses=_errors(400, 404, 409, 413, 415, 507),
)
async def upload_document(
    request: Request,
    uploads: UploadServiceDep,
    documents: DocumentServiceDep,
    x_file_name: Annotated[str, Header(description="Percent-encoded UTF-8 file name.")],
    content_length: Annotated[int | None, Header(ge=0)] = None,
    content_type: Annotated[str | None, Header()] = None,
    chat_id: Annotated[
        UUID | None,
        Query(
            description="Upload into this chat: searched only there, not listed in the "
            "library. The same file again attaches the existing document instead of 409."
        ),
    ] = None,
) -> DocumentEnvelopeOut:
    """Raw body, one file per request. Answers 202 at once; ingestion runs in the background.
    Without `chat_id` the file goes into the library; an attachment with the same bytes
    moves there instead of 409."""
    if (content_type or "").split(";")[0].strip() != "application/octet-stream":
        raise _header_error("content-type", "Content-Type must be application/octet-stream.")
    if content_length is None:
        raise _header_error("content-length", "Content-Length is required.")
    document = await uploads.accept(
        x_file_name,
        content_length,
        _body(request),
        chat_id=None if chat_id is None else str(chat_id),
    )
    return DocumentEnvelopeOut(document=DocumentOut.from_view(documents.view(document)))


def _import_out(job: ImportJob, container: ContainerDep) -> ImportEnvelopeOut:
    view = container.documents.view(job.document) if job.document is not None else None
    return ImportEnvelopeOut(job=ImportOut.from_job(job, view))


@router.post(
    "/import-url",
    status_code=202,
    response_model=ImportEnvelopeOut,
    responses=_errors(429),
)
async def import_url(body: ImportUrlIn, container: ContainerDep) -> ImportEnvelopeOut:
    """Downloads a PDF, HTML page, text or Markdown file from a link in the background and
    feeds it to the upload path (checks, malware scan, ingestion). Poll the job. Refused at
    once: URL_INVALID, URL_BLOCKED (local, private or internal addresses), RATE_LIMITED.
    Later, in the job: URL_UNREACHABLE, URL_TIMEOUT, URL_TOO_LARGE, URL_UNSUPPORTED_TYPE and
    the upload errors."""
    job = container.url_imports.start(
        body.url,
        library=body.library,
        chat_id=None if body.chat_id is None else str(body.chat_id),
    )
    return _import_out(job, container)


@router.get("/imports/{job_id}", response_model=ImportEnvelopeOut, responses=_errors(404))
def get_import(job_id: UUID, container: ContainerDep) -> ImportEnvelopeOut:
    """Progress (`received_bytes` of `total_bytes`), then the document or the error."""
    return _import_out(container.url_imports.get(str(job_id)), container)


@router.delete("/imports/{job_id}", status_code=204, responses=_errors(404))
async def cancel_import(job_id: UUID, container: ContainerDep) -> Response:
    """Stops a running download; a document already handed over stays."""
    container.url_imports.cancel(str(job_id))
    return Response(status_code=204)


@router.get("", response_model=DocumentListOut)
def list_documents(documents: DocumentServiceDep) -> DocumentListOut:
    """The library, newest first. Poll while any is not `ready` or `failed`. Documents
    uploaded into a chat are listed by `GET /api/chats/{chat_id}/attachments`."""
    return DocumentListOut(documents=[DocumentOut.from_view(v) for v in documents.list()])


@router.get("/{document_id}", response_model=DocumentEnvelopeOut, responses=_errors(404))
def get_document(document_id: UUID, documents: DocumentServiceDep) -> DocumentEnvelopeOut:
    return DocumentEnvelopeOut(document=DocumentOut.from_view(documents.get(str(document_id))))


@router.post("/{document_id}/library", response_model=DocumentEnvelopeOut, responses=_errors(404))
def add_document_to_library(
    document_id: UUID, documents: DocumentServiceDep
) -> DocumentEnvelopeOut:
    """Moves a chat attachment into the library. Idempotent."""
    return DocumentEnvelopeOut(
        document=DocumentOut.from_view(documents.add_to_library(str(document_id)))
    )


@router.delete("/{document_id}", status_code=204, responses=_errors(404, 500))
async def delete_document(document_id: UUID, documents: DocumentServiceDep) -> Response:
    """Allowed in every status; stops a running ingestion."""
    await documents.delete(str(document_id))
    return Response(status_code=204)


@router.get(
    "/{document_id}/file",
    response_class=FileResponse,
    responses={
        200: {"content": {"application/pdf": {}, "text/plain": {}}},
        206: {"description": "Partial content for a Range request."},
        **_errors(404, 409, 410, 416),
    },
)
def get_document_file(
    document_id: UUID,
    documents: DocumentServiceDep,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> FileResponse:
    """The original file with safe headers. Supports Range requests (PDF viewer)."""
    stored = documents.file(str(document_id))
    try:
        size = stored.path.stat().st_size
    except FileNotFoundError as exc:  # deleted between the lookup and now
        raise AppError(ErrorCode.DOCUMENT_FILE_MISSING) from exc
    check_range(range_header, size)
    disposition = f"inline; filename*=UTF-8''{quote(stored.filename, safe='')}"
    return FileResponse(
        stored.path,
        media_type=_MEDIA_TYPES[stored.kind],
        headers={**_FILE_HEADERS, "Content-Disposition": disposition},
    )


@router.get(
    "/{document_id}/text",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/plain": {}}}, **_errors(404, 409, 410)},
)
def get_document_text(document_id: UUID, documents: DocumentServiceDep) -> PlainTextResponse:
    """TXT/MD/HTML as the decoded, normalized text that sentence offsets refer to (text
    viewer). For HTML that is the visible text of the page, without markup."""
    return PlainTextResponse(
        documents.text(str(document_id)),
        media_type=_MEDIA_TYPES[DocumentKind.TXT],
        headers=_FILE_HEADERS,
    )


@router.get("/{document_id}/chunks/{chunk_id}", response_model=ChunkOut, responses=_errors(404))
def get_chunk(document_id: UUID, chunk_id: UUID, documents: DocumentServiceDep) -> ChunkOut:
    """One chunk with its sentences and line rectangles, for highlighting a citation."""
    return ChunkOut.from_chunk(documents.chunk(str(document_id), str(chunk_id)))
