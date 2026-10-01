"""One secret in a file below the data directory, readable by the app's user only.

Not in SQLite on purpose: the database is exported and backed up with the workspace, the key
must not be. The file is written to a private temp file first and renamed into place, so a
crash never leaves half a key; the folder is 0700, the file 0600."""

import contextlib
import os
from pathlib import Path


class FileSecretStore:
    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> str | None:
        try:
            value = self._path.read_text("utf-8").strip()
        except FileNotFoundError:
            return None
        return value or None

    def save(self, value: str) -> None:
        folder = self._path.parent
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(folder, 0o700)
        temp = folder / f".{self._path.name}.tmp"
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(value)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, self._path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                temp.unlink()
            raise

    def delete(self) -> None:
        """Overwrites the file before removing it, so the key does not linger in its blocks."""
        try:
            size = self._path.stat().st_size
        except FileNotFoundError:
            return
        with open(self._path, "r+b") as handle:
            handle.write(b"\0" * size)
            handle.flush()
            os.fsync(handle.fileno())
        with contextlib.suppress(FileNotFoundError):
            self._path.unlink()
