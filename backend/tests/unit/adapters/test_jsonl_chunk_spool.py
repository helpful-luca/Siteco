from pathlib import Path

from docchat.adapters.jsonl_chunk_spool import JsonlChunkSpool
from docchat.domain.models import Chunk, Sentence


def _chunk(n: int) -> Chunk:
    return Chunk(
        chunk_id=f"c{n}",
        document_id="d",
        ordinal=n,
        page=n + 1,
        heading="Größe",
        text=f"Satz {n}.",
        search_text=f"Dokument: d\nSatz {n}.",
        sentences=(Sentence(0, f"Satz {n}.", 0, 7, ((0.1, 0.2, 0.3, 0.04),)),),
        precise_highlight=n % 2 == 0,
    )


def test_round_trip_in_batches(tmp_path: Path) -> None:
    spool = JsonlChunkSpool(tmp_path / "spool")
    writer = spool.writer("d")
    writer.write([_chunk(0), _chunk(1)])
    writer.write([_chunk(2)])
    writer.close()
    reader = spool.reader("d")
    assert reader.read(2) == [_chunk(0), _chunk(1)]
    assert reader.read(2) == [_chunk(2)]
    assert reader.read(2) == []
    reader.close()
    spool.discard("d")
    spool.discard("d")
    assert not (tmp_path / "spool" / "d.jsonl").exists()
    spool.clear()
    assert not (tmp_path / "spool").exists()
