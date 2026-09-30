"""Build-time step: download the embedding model, then prove it loads and works offline."""

import os
import sys
from pathlib import Path

from docchat.adapters.fastembed_embedder import GRANITE_97M, FastEmbedEmbedder

MIN_CROSS_LINGUAL_SIMILARITY = 0.7


def main() -> int:
    model = os.environ.get("EMBEDDING_MODEL", GRANITE_97M)
    cache_dir = Path(os.environ.get("EMBEDDING_CACHE_DIR", "/opt/models"))

    FastEmbedEmbedder(model, cache_dir, local_files_only=False).load()

    os.environ["HF_HUB_OFFLINE"] = "1"
    offline = FastEmbedEmbedder(model, cache_dir, local_files_only=True)
    offline.load()
    german, english = offline.embed_documents(
        ["Die Leuchte hat die Schutzart IP66.", "The luminaire has protection class IP66."]
    )
    similarity = sum(a * b for a, b in zip(german, english, strict=True))
    print(f"model={model} dim={offline.dim} de_en_cosine={similarity:.3f}")
    if similarity < MIN_CROSS_LINGUAL_SIMILARITY:
        print("embedding smoke test failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
