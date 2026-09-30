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
    ) -> None:
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

    async def build(self) -> Iterator[bytes]:
        """Packs the archive in a worker thread, then hands it out in chunks."""
        spooled = tempfile.SpooledTemporaryFile(max_size=_SPOOL_BYTES)  # noqa: SIM115 closed by _chunks
        try:
            await asyncio.to_thread(self._write, spooled)
        except BaseException:
            spooled.close()
            raise
        return self._chunks(spooled)
