"""The settings that change what retrieval finds. The eval runner stores their hash with the
results, so a result file says which configuration it measured."""

from docchat.core.config import Settings
from docchat.domain.chunking import TARGET_TOKENS


def retrieval_fingerprint(settings: Settings) -> dict[str, str | int | float | None]:
    return {
        "embedding_model": settings.embedding_model,
        "fts_language": settings.fts_language,
        "chunk_target_tokens": TARGET_TOKENS,
        "candidates": settings.retrieval_candidates,
        "top_k": settings.top_k,
        "per_document_cap": settings.per_document_cap,
        "full_context_max_tokens": settings.full_context_max_tokens,
    }
