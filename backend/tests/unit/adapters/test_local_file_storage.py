from pathlib import Path

from docchat.adapters.local_file_storage import LocalFileStorage
from docchat.domain.enums import DocumentKind


def test_upload_is_temp_until_committed(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path / "uploads")
    sink = storage.new_upload()
    sink.write(b"%PDF-1.4 ")
    sink.write(b"rest")
    assert sink.path.parent.name == "tmp"
    assert not storage.exists("doc", DocumentKind.PDF)
    storage.commit(sink, "doc", DocumentKind.PDF)
    assert storage.path_for("doc", DocumentKind.PDF).read_bytes() == b"%PDF-1.4 rest"
    assert not sink.path.exists()


def test_discard_removes_the_temp_file(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path / "uploads")
    sink = storage.new_upload()
    sink.write(b"x")
    sink.discard()
    assert not sink.path.exists()


def test_sweep_keeps_known_documents_and_clears_temp(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path / "uploads")
    for doc_id in ("keep", "orphan"):
        sink = storage.new_upload()
        sink.write(b"x")
        storage.commit(sink, doc_id, DocumentKind.TXT)
    leftover = storage.new_upload()
    leftover.write(b"half")
    assert storage.delete_except({"keep"}) == 1
    storage.clear_temp()
    assert storage.exists("keep", DocumentKind.TXT)
    assert not storage.exists("orphan", DocumentKind.TXT)
    assert not leftover.path.exists()
    storage.delete("keep", DocumentKind.TXT)
    storage.delete("keep", DocumentKind.TXT)  # idempotent
    assert storage.free_bytes() > 0
