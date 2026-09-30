"""Original files on disk as `<document id>.<kind>`.

Uploads land in `tmp/` first, wait in the quarantine (a directory outside the library) until the
malware scan passed, and only then become library files.
"""

import os
import shutil
import threading
from collections.abc import Collection
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from docchat.domain.enums import DocumentKind
from docchat.domain.ports import UploadSink


def _delete_files_except(directory: Path, keep: Collection[str]) -> int:
    removed = 0
    if not directory.exists():
        return removed
    for path in directory.iterdir():
        if path.is_file() and path.stem not in keep:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


class _TempUpload:
    """Written from a worker thread. A cancelled request may discard it while a write is still
    running, so writing, closing and discarding take turns under one lock."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._file: BinaryIO | None = path.open("xb")
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path

    def write(self, data: bytes) -> None:
        with self._lock:
            if self._file is not None:  # discarded meanwhile: nothing left to write to
                self._file.write(data)

    def close(self) -> None:
        with self._lock:
            if self._file is not None:
                self._file.flush()
                os.fsync(self._file.fileno())
                self._file.close()
                self._file = None

    def discard(self) -> None:
        with self._lock:
            if self._file is not None:
                self._file.close()
                self._file = None
            self._path.unlink(missing_ok=True)


class LocalFileStorage:
    def __init__(self, root: Path, quarantine: Path | None = None) -> None:
        self.root = root
        self._tmp = root / "tmp"
        self._quarantine = quarantine or root.parent / "quarantine"

    def _ensure_dirs(self) -> None:
        self._tmp.mkdir(parents=True, exist_ok=True)

    def new_upload(self) -> _TempUpload:
        self._ensure_dirs()
        return _TempUpload(self._tmp / f"{uuid4().hex}.part")

    def commit(self, sink: UploadSink, document_id: str, kind: DocumentKind) -> None:
        sink.close()
        os.replace(sink.path, self.path_for(document_id, kind))

    def path_for(self, document_id: str, kind: DocumentKind) -> Path:
        return self.root / f"{document_id}.{kind.value}"

    def exists(self, document_id: str, kind: DocumentKind) -> bool:
        return self.path_for(document_id, kind).is_file()

    def quarantine(self, sink: UploadSink, document_id: str, kind: DocumentKind) -> None:
        sink.close()
        self._quarantine.mkdir(parents=True, exist_ok=True)
        os.replace(sink.path, self.quarantined_path(document_id, kind))

    def quarantined_path(self, document_id: str, kind: DocumentKind) -> Path:
        return self._quarantine / f"{document_id}.{kind.value}"

    def is_quarantined(self, document_id: str, kind: DocumentKind) -> bool:
        return self.quarantined_path(document_id, kind).is_file()

    def release(self, document_id: str, kind: DocumentKind) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        os.replace(self.quarantined_path(document_id, kind), self.path_for(document_id, kind))

    def discard_quarantined(self, document_id: str, kind: DocumentKind) -> None:
        self.quarantined_path(document_id, kind).unlink(missing_ok=True)

    def discard_quarantined_except(self, keep: Collection[str]) -> int:
        return _delete_files_except(self._quarantine, keep)

    def delete(self, document_id: str, kind: DocumentKind) -> None:
        self.path_for(document_id, kind).unlink(missing_ok=True)

    def delete_except(self, keep: Collection[str]) -> int:
        """Removes library files whose document no longer exists. Returns how many."""
        return _delete_files_except(self.root, keep)

    def clear_temp(self) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)
        self._ensure_dirs()

    def free_bytes(self) -> int:
        self._ensure_dirs()
        return shutil.disk_usage(self.root).free
