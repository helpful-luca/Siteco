"""Accepts one upload: cheap checks first, then the body is streamed to a temp file.

Order (annex 10, C): name and extension, declared size, quota and free disk, uploads per minute,
magic bytes while streaming, byte count, duplicate by SHA-256, atomic rename into the quarantine,
row `scanning`.

An upload into a chat (`chat_id`) is an attachment: searched in that chat only, not listed in the
library. The same bytes again attach the existing document instead of failing as a duplicate;
uploaded in the library they move an attachment into the library.
The malware scan and everything that opens the document happen later in background workers.
"""

import asyncio
import hashlib
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import uuid4

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.models import Document
from docchat.domain.ports import (
    Clock,
    DocumentRepository,
    FileStorage,
    ScanScheduler,
    UploadSink,
)
from docchat.domain.upload_validation import (
    MAGIC_WINDOW,
    content_matches_kind,
    decode_file_name_header,
    kind_for_filename,
    sanitize_filename,
    text_chunk_is_binary,
)
from docchat.services.limits import RateLimit

log = logging.getLogger("docchat.upload")

_MB = 1024 * 1024


@dataclass(frozen=True)
class UploadLimits:
    max_bytes: int
    max_storage_bytes: int
    min_free_bytes: int  # always leave this much disk space for SQLite, LanceDB and logs


class _Receiver:
    """Writes the body to the sink, hashing and checking the content on the way."""

    def __init__(self, sink: UploadSink, kind: DocumentKind, max_bytes: int) -> None:
        self.sink = sink
        self.kind = kind
        self.max_bytes = max_bytes
        self.size = 0
        self.head = b""
        self.head_checked = False
        self.sha256 = hashlib.sha256()

    def _check_head(self) -> None:
        if not content_matches_kind(self.kind, self.head):
            raise AppError(ErrorCode.FILE_CONTENT_MISMATCH)
        self.head_checked = True

    def write(self, data: bytes) -> None:
        self.size += len(data)
        if self.size > self.max_bytes:
            raise AppError(ErrorCode.UPLOAD_TOO_LARGE, params={"max_mb": self.max_bytes // _MB})
        if not self.head_checked:
            self.head += data[: MAGIC_WINDOW + 8 - len(self.head)]
            if len(self.head) >= MAGIC_WINDOW + 8:
                self._check_head()
        if self.kind is not DocumentKind.PDF and text_chunk_is_binary(self.head, data):
            raise AppError(ErrorCode.FILE_CONTENT_MISMATCH)
        self.sha256.update(data)
        try:
            self.sink.write(data)
        except OSError as exc:
            raise AppError(ErrorCode.STORAGE_FULL) from exc

    def finish(self) -> None:
        if not self.head_checked:
            self._check_head()


class UploadService:
    def __init__(
        self,
        repository: DocumentRepository,
        storage: FileStorage,
        scans: ScanScheduler,
        clock: Clock,
        limits: UploadLimits,
        rate: RateLimit | None = None,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._scans = scans
        self._clock = clock
        self._limits = limits
        self._rate = rate  # uploads per minute; None: no limit

    def _check_name(self, header: str) -> tuple[str, DocumentKind]:
        decoded = decode_file_name_header(header)
        if decoded is None:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "X-File-Name must be percent-encoded UTF-8.",
                details=[{"loc": ["header", "x-file-name"], "type": "value_error"}],
            )
        filename = sanitize_filename(decoded)
        kind = kind_for_filename(filename)
        if kind is None:
            raise AppError(ErrorCode.UNSUPPORTED_TYPE)
        return filename, kind

    async def _check_space(self, declared: int | None) -> None:
        """`declared` None: the size is unknown until the end (a download without
        Content-Length); the byte count while streaming and the check after it hold."""
        limits = self._limits
        if declared == 0:
            raise AppError(ErrorCode.EMPTY_FILE)
        if declared is not None and declared > limits.max_bytes:
            raise AppError(ErrorCode.UPLOAD_TOO_LARGE, params={"max_mb": limits.max_bytes // _MB})
        await self._check_quota(declared or 0)
        free = await asyncio.to_thread(self._storage.free_bytes)
        if free - (declared or 0) < limits.min_free_bytes:
            raise AppError(ErrorCode.STORAGE_FULL)

    async def _check_quota(self, size: int) -> None:
        limits = self._limits
        used = await asyncio.to_thread(self._repository.total_size_bytes)
        if used + size > limits.max_storage_bytes:
            raise AppError(
                ErrorCode.STORAGE_QUOTA, params={"max_mb": limits.max_storage_bytes // _MB}
            )

    async def accept(
        self,
        file_name: str,
        declared_size: int | None,
        body: AsyncIterator[bytes],
        *,
        chat_id: str | None = None,
        in_library: bool | None = None,
        source_url: str | None = None,
        rate_counted: bool = False,
    ) -> Document:
        """`in_library` defaults to "not uploaded into a chat"; a link import can ask for both
        (`chat_id` and `in_library`). `rate_counted`: the caller already took the slot."""
        to_library = chat_id is None if in_library is None else in_library or chat_id is None
        filename, kind = self._check_name(file_name)
        await self._check_space(declared_size)
        if self._rate is not None and not rate_counted:
            self._rate.acquire()  # after the cheap checks: a refused file never counts
        sink = await asyncio.to_thread(self._storage.new_upload)
        try:
            receiver = _Receiver(sink, kind, self._limits.max_bytes)
            async for data in body:
                if data:
                    await asyncio.to_thread(receiver.write, data)
            if declared_size is None:
                if receiver.size == 0:
                    raise AppError(ErrorCode.EMPTY_FILE)
                await self._check_quota(receiver.size)
            elif receiver.size != declared_size:
                raise AppError(ErrorCode.UPLOAD_INCOMPLETE)
            receiver.finish()
            existing = await asyncio.to_thread(
                self._repository.find_by_sha256, receiver.sha256.hexdigest()
            )
            if existing is not None and existing.status is DocumentStatus.FAILED:
                retried = await self._retry(existing, sink)
                return await self._place(retried, chat_id, to_library)
            if existing is None:
                document = self._new_document(
                    filename, kind, receiver, in_library=to_library, source_url=source_url
                )
                await asyncio.to_thread(self._storage.quarantine, sink, document.id, kind)
        except BaseException:
            await asyncio.to_thread(sink.discard)
            raise
        if existing is not None:
            await asyncio.to_thread(sink.discard)
            if chat_id is None and existing.in_library:
                raise AppError(ErrorCode.DUPLICATE_DOCUMENT, params={"existing_id": existing.id})
            return await self._place(existing, chat_id, to_library)
        try:
            await asyncio.to_thread(self._repository.insert, document, attach_to=chat_id)
        except BaseException:
            await asyncio.to_thread(self._storage.discard_quarantined, document.id, kind)
            raise
        self._scans.enqueue(document)
        log.info(
            "upload_accepted",
            extra={"document_id": document.id, "kind": kind.value, "size_bytes": receiver.size},
        )
        return document

    async def _place(self, document: Document, chat_id: str | None, to_library: bool) -> Document:
        """An existing document where this upload wanted it: chat, library, or both."""
        now = self._clock.now()
        if chat_id is not None and not await asyncio.to_thread(
            self._repository.attach, chat_id, document.id, now
        ):
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        if to_library and not document.in_library:
            await asyncio.to_thread(self._repository.add_to_library, document.id, now)
        placed = await asyncio.to_thread(self._repository.get, document.id)
        if placed is None:  # deleted a moment ago
            raise AppError(ErrorCode.UPLOAD_INCOMPLETE)
        return placed

    def _new_document(
        self,
        filename: str,
        kind: DocumentKind,
        receiver: _Receiver,
        *,
        in_library: bool,
        source_url: str | None,
    ) -> Document:
        now = self._clock.now()
        return Document(
            id=str(uuid4()),
            filename=filename,
            kind=kind,
            size_bytes=receiver.size,
            sha256=receiver.sha256.hexdigest(),
            status=DocumentStatus.SCANNING,
            created_at=now,
            updated_at=now,
            in_library=in_library,
            source_url=source_url,
        )

    async def _retry(self, failed: Document, sink: UploadSink) -> Document:
        """Same bytes as a failed document: scan and process that one again (annex 10, C6).

        Reset the row first, so a concurrent delete either wins before (then this is a
        duplicate of nothing: DUPLICATE_DOCUMENT) or is detected after the file was put back.
        """
        if not await asyncio.to_thread(self._repository.rescan, failed.id, self._clock.now()):
            raise AppError(ErrorCode.DUPLICATE_DOCUMENT, params={"existing_id": failed.id})
        await asyncio.to_thread(self._storage.quarantine, sink, failed.id, failed.kind)
        rescanning = await asyncio.to_thread(self._repository.get, failed.id)
        if rescanning is None or rescanning.status is not DocumentStatus.SCANNING:
            await asyncio.to_thread(self._storage.discard_quarantined, failed.id, failed.kind)
            raise AppError(ErrorCode.UPLOAD_INCOMPLETE)
        self._scans.enqueue(rescanning)
        return rescanning
