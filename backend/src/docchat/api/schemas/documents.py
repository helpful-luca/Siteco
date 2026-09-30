from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import ErrorCode, NoticeCode
from docchat.domain.models import Chunk
from docchat.services.document_service import DocumentView


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
