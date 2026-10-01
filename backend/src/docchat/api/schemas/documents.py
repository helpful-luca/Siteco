from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import ERROR_SPECS, ErrorCode, NoticeCode
from docchat.domain.models import Chunk
from docchat.services.document_service import DocumentView
from docchat.services.url_import_service import ImportJob, ImportState


class NoticeOut(BaseModel):
    code: NoticeCode
    params: dict[str, int | str] = Field(default_factory=dict)


class DocumentOut(BaseModel):
    id: str
    filename: str = Field(description="Display name only. Render as text, never as HTML.")
    kind: DocumentKind
    size_bytes: int
    page_count: int | None
    chunk_count: int | None
    status: DocumentStatus
    progress: Annotated[float, Field(ge=0, le=1, description="0..1 within the current status.")]
    queue_position: int | None = Field(description="1-based place in the queue while queued.")
    error_code: ErrorCode | None = Field(description="Why the document is `failed`.")
    error_params: dict[str, int | str] = Field(
        description="Details for the error text, e.g. the signature for MALWARE_DETECTED.",
    )
    notices: list[NoticeOut]
    created_at: datetime
    ready_at: datetime | None
    in_library: bool = Field(
        description="False: uploaded into a chat, listed and searched only there."
    )
    source_url: str | None = Field(
        default=None, description="The link it was imported from. Render as text."
    )

    @classmethod
    def from_view(cls, view: DocumentView) -> "DocumentOut":
        d = view.document
        return cls(
            id=d.id,
            filename=d.filename,
            kind=d.kind,
            size_bytes=d.size_bytes,
            page_count=d.page_count,
            chunk_count=d.chunk_count,
            status=d.status,
            progress=d.progress,
            queue_position=view.queue_position,
            error_code=d.error_code,
            error_params=dict(d.error_params),
            notices=[NoticeOut(code=n.code, params=dict(n.params)) for n in d.notices],
            created_at=d.created_at,
            ready_at=d.ready_at,
            in_library=d.in_library,
            source_url=d.source_url,
        )


class DocumentEnvelopeOut(BaseModel):
    document: DocumentOut


class DocumentListOut(BaseModel):
    documents: list[DocumentOut]


class SentenceOut(BaseModel):
    i: int
    text: str
    char_start: int = Field(description="Offset in the page text (PDF) or document text (TXT/MD).")
    char_end: int
    rects: list[tuple[float, float, float, float]] = Field(
        description="One (x, y, w, h) per line, 0..1 of the displayed page, origin top left."
    )


class ChunkOut(BaseModel):
    chunk_id: str
    page: int | None
    precise_highlight: bool = Field(description="False: highlight the page, not the sentences.")
    text: str
    sentences: list[SentenceOut]

    @classmethod
    def from_chunk(cls, chunk: Chunk) -> "ChunkOut":
        return cls(
            chunk_id=chunk.chunk_id,
            page=chunk.page,
            precise_highlight=chunk.precise_highlight,
            text=chunk.text,
            sentences=[
                SentenceOut(
                    i=s.i,
                    text=s.text,
                    char_start=s.char_start,
                    char_end=s.char_end,
                    rects=list(s.rects),
                )
                for s in chunk.sentences
            ],
        )


class ImportUrlIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(max_length=4096, description="http or https; no credentials.")
    library: bool = Field(
        default=True, description="Also into the library. Without `chat_id` always true."
    )
    chat_id: UUID | None = Field(default=None, description="Import into this chat.")


class ImportOut(BaseModel):
    id: str
    url: str = Field(description="The normalized link. Render as text.")
    state: ImportState
    received_bytes: int
    total_bytes: int | None = Field(description="From Content-Length; null when unknown.")
    document: DocumentOut | None = Field(description="Once `done`: the new document.")
    error_code: ErrorCode | None = Field(description="Why the import `failed`.")
    error_params: dict[str, int | str]
    retryable: bool = Field(description="Starting the same import again may work.")

    @classmethod
    def from_job(cls, job: ImportJob, document: DocumentView | None) -> "ImportOut":
        return cls(
            id=job.id,
            url=job.url,
            state=job.state,
            received_bytes=job.received,
            total_bytes=job.total,
            document=DocumentOut.from_view(document) if document is not None else None,
            error_code=job.error_code,
            error_params=dict(job.error_params),
            retryable=job.error_code is not None and ERROR_SPECS[job.error_code].retryable,
        )


class ImportEnvelopeOut(BaseModel):
    job: ImportOut
