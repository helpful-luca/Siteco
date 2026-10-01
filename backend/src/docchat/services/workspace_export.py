"""Data portability (master spec 10b, 5): a ZIP with every chat as JSON and Markdown, the
preferences and the document list. Document files stay out: they are the user's own
originals, and a library of up to 20 GB does not belong in a download of this kind."""

import asyncio
import json
import tempfile
import zipfile
from collections.abc import Iterator
from dataclasses import asdict
from datetime import UTC
from pathlib import Path
from typing import IO, Any

from docchat.domain.export_format import chat_markdown, chat_record, entry_stem
from docchat.domain.ports import ChatRepository, Clock, DocumentRepository
from docchat.domain.redaction import without_text_of
from docchat.services.preferences_service import PreferencesService

_CHUNK = 64 * 1024
# Small exports stay in memory, larger ones move to a temp file on their own.
_SPOOL_BYTES = 8 * 1024 * 1024


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


class WorkspaceExport:
    def __init__(
        self,
        chats: ChatRepository,
        documents: DocumentRepository,
        preferences: PreferencesService,
        clock: Clock,
        tmp_dir: Path,
    ) -> None:
        self._tmp_dir = tmp_dir
        self._chats = chats
        self._documents = documents
        self._preferences = preferences
        self._clock = clock

    def filename(self) -> str:
        return f"siteco-document-chat-{self._clock.now().astimezone(UTC).date().isoformat()}.zip"

    def _write(self, target: IO[bytes]) -> None:
        prefs = self._preferences.get()
        documents = self._documents.list_visible()
        existing = {d.id for d in documents}
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("preferences.json", _json(asdict(prefs)))
            archive.writestr(
                "documents.json",
                _json(
                    {
                        "documents": [
                            {
                                "id": d.id,
                                "filename": d.filename,
                                "kind": d.kind.value,
                                "size_bytes": d.size_bytes,
                                "page_count": d.page_count,
                                "status": d.status.value,
                                "in_library": d.in_library,
                                "created_at": d.created_at.isoformat(),
                            }
                            for d in documents
                        ]
                    }
                ),
            )
            summaries = sorted(self._chats.list_chats(), key=lambda s: s.chat.created_at)
            for index, summary in enumerate(summaries, start=1):
                chat = summary.chat
                messages = [
                    without_text_of(m, {s.document_id for s in m.sources} - existing)
                    for m in self._chats.list_messages(chat.id)
                ]
                stem = f"chats/{entry_stem(index, chat.title)}"
                archive.writestr(f"{stem}.json", _json(chat_record(chat, messages)))
                archive.writestr(f"{stem}.md", chat_markdown(chat, messages, prefs.locale))

    def _chunks(self, spooled: IO[bytes]) -> Iterator[bytes]:
        try:
            spooled.seek(0)
            while chunk := spooled.read(_CHUNK):
                yield chunk
        finally:
            spooled.close()

    async def build(self) -> tuple[Iterator[bytes], IO[bytes]]:
        """Packs the archive in a worker thread, then hands it out in chunks. Above 8 MB it
        spills into the app's own data directory (never the system temp dir), as an unnamed
        file that disappears when closed: after the last chunk, or by the caller when the
        download is aborted (the returned handle; closing twice is harmless)."""
        self._tmp_dir.mkdir(parents=True, exist_ok=True)
        spooled = tempfile.SpooledTemporaryFile(  # noqa: SIM115 closed by _chunks or the caller
            max_size=_SPOOL_BYTES, dir=str(self._tmp_dir)
        )
        try:
            await asyncio.to_thread(self._write, spooled)
        except BaseException:
            spooled.close()
            raise
        return self._chunks(spooled), spooled
