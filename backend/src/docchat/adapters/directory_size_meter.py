"""Disk space the app uses: everything below the data directory (database, index, files)."""

import os
from pathlib import Path


class DirectorySizeMeter:
    def __init__(self, root: Path) -> None:
        self._root = root

    def used_bytes(self) -> int:
        total = 0
        stack = [self._root]
        while stack:
            try:
                entries = list(os.scandir(stack.pop()))
            except OSError:
                continue  # missing or removed while counting
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    continue
        return total
