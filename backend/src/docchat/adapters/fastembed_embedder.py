"""Local multilingual embeddings via fastembed (ONNX on CPU, no torch)."""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import onnxruntime
from fastembed import TextEmbedding
from fastembed.common.model_description import ModelSource, PoolingType

GRANITE_97M = "ibm-granite/granite-embedding-97m-multilingual-r2"
# Chunks are about 400 tokens; the tokenizer config would allow far more.
MAX_TOKENS = 512


@dataclass(frozen=True)
class _CustomModel:
    dim: int
    pooling: PoolingType
    model_file: str


# Models fastembed does not ship natively. Granite R2 is ModernBERT with CLS pooling.
_CUSTOM_MODELS = {
    GRANITE_97M: _CustomModel(dim=384, pooling=PoolingType.CLS, model_file="onnx/model.onnx"),
}


def register_custom_models() -> None:
    supported = {m["model"] for m in TextEmbedding.list_supported_models()}
    for name, spec in _CUSTOM_MODELS.items():
        if name in supported:
            continue
        TextEmbedding.add_custom_model(
            model=name,
            pooling=spec.pooling,
            normalization=True,
            sources=ModelSource(hf=name),
            dim=spec.dim,
            model_file=spec.model_file,
        )


class FastEmbedEmbedder:
    def __init__(
        self,
        model_name: str,
        cache_dir: Path,
        *,
        local_files_only: bool,
        threads: int | None = None,
    ) -> None:
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.local_files_only = local_files_only
        self.threads = threads
        custom = _CUSTOM_MODELS.get(model_name)
        self.dim = custom.dim if custom else 0
        self._model: TextEmbedding | None = None

    def load(self) -> None:
        # Second guard next to ORT_DISABLE_TELEMETRY (docchat/__init__.py), before any session.
        onnxruntime.disable_telemetry_events()
        register_custom_models()
        self._model = TextEmbedding(
            self.model_name,
            cache_dir=str(self.cache_dir),
            local_files_only=self.local_files_only,
            threads=self.threads,
        )
        tokenizer = getattr(self._model.model, "tokenizer", None)
        if tokenizer is not None:
            tokenizer.enable_truncation(max_length=MAX_TOKENS)
        self.dim = len(self.embed_query("Leuchte"))

    def _require_model(self) -> TextEmbedding:
        if self._model is None:
            raise RuntimeError("embedder not loaded")
        return self._model

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(x) for x in vector] for vector in self._require_model().embed(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]
