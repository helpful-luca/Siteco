from docchat.domain.models import Chunk


def make_chunk(
    chunk_id: str, *, text: str = "", page: int | None = 1, document_id: str = "d", ordinal: int = 0
) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        document_id=document_id,
        ordinal=ordinal,
        page=page,
        heading="",
        text=text,
        search_text=text,
        sentences=(),
    )
