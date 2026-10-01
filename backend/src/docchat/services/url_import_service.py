"""Import a document from a link (feedback 1, item 7).

The backend downloads the file and feeds the same path as an upload (size and magic checks,
quarantine, malware scan, parsing, ingestion). A download can take minutes for a large
catalog, so it runs as a job in the background; the UI polls its progress. Jobs live in
memory: a restart ends a running download, and the user starts it again.

Security (SSRF): the URL and every redirect target are checked by the rules in
`domain.url_import`; each hop's name is resolved once, every address must be public, and the
fetcher connects to that vetted address (no second lookup, so DNS rebinding cannot redirect
the connection). No cookies, no credentials, no proxy from the environment.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from urllib.parse import urljoin

from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.models import Document
from docchat.domain.ports import ChatRepository, HostResolver, UrlFetcher
from docchat.domain.url_import import (
    MAX_REDIRECTS,
    ParsedUrl,
    address_is_public,
    host_is_blocked,
    import_file_name,
    import_kind,
    parse_import_url,
)
from docchat.services.limits import RateLimit
from docchat.services.upload_service import UploadService

log = logging.getLogger("docchat.url_import")

_REDIRECTS = frozenset({301, 302, 303, 307, 308})
# Upload errors that mean "the link gave us something we cannot take".
_AS_LINK_ERROR = {
    ErrorCode.UPLOAD_TOO_LARGE: ErrorCode.URL_TOO_LARGE,
    ErrorCode.FILE_CONTENT_MISMATCH: ErrorCode.URL_UNSUPPORTED_TYPE,
    ErrorCode.UNSUPPORTED_TYPE: ErrorCode.URL_UNSUPPORTED_TYPE,
    ErrorCode.UPLOAD_INCOMPLETE: ErrorCode.URL_UNREACHABLE,
}
_KEEP_FINISHED = 50  # finished jobs kept for the UI's last poll


class ImportState(StrEnum):
    DOWNLOADING = "downloading"
    DONE = "done"
    FAILED = "failed"


@dataclass
class ImportJob:
    id: str
    url: str
    chat_id: str | None
    in_library: bool
    state: ImportState = ImportState.DOWNLOADING
    received: int = 0
    total: int | None = None  # Content-Length, when the server sent one
    document: Document | None = None
    error_code: ErrorCode | None = None
    error_params: dict[str, Any] = field(default_factory=dict)
    task: asyncio.Task[None] | None = None


class UrlImportService:
    def __init__(
        self,
        uploads: UploadService,
        chats: ChatRepository,
        resolver: HostResolver,
        fetcher: UrlFetcher,
        *,
        max_bytes: int,
        total_timeout_s: float,
        rate: RateLimit | None = None,
        is_public: Callable[[str], bool] = address_is_public,
    ) -> None:
        self._uploads = uploads
        self._chats = chats
        self._resolver = resolver
        self._fetcher = fetcher
        self._max_bytes = max_bytes
        self._total_timeout_s = total_timeout_s
        self._rate = rate  # counts like an upload
        self._is_public = is_public  # tests allow their local server here, nothing else
        self._jobs: dict[str, ImportJob] = {}

    def start(self, raw_url: str, *, library: bool, chat_id: str | None) -> ImportJob:
        """Checks what can be checked at once (URL_INVALID, URL_BLOCKED, RATE_LIMITED), then
        downloads in the background. Without a chat the document always goes to the library."""
        url = parse_import_url(raw_url)
        self._check_name(url)
        if chat_id is not None and self._chats.get_chat(chat_id) is None:
            raise AppError(ErrorCode.CHAT_NOT_FOUND)
        if self._rate is not None:
            self._rate.acquire()
        job = ImportJob(
            id=str(uuid.uuid4()),
            url=url.text,
            chat_id=chat_id,
            in_library=library or chat_id is None,
        )
        job.task = asyncio.create_task(self._run(job, url), name=f"url-import-{job.id}")
        self._jobs[job.id] = job
        self._forget_old()
        log.info("url_import_started", extra={"job_id": job.id})  # never the URL: personal
        return job

    def get(self, job_id: str) -> ImportJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise AppError(ErrorCode.NOT_FOUND)
        return job

    def cancel(self, job_id: str) -> None:
        job = self._jobs.pop(job_id, None)
        if job is None:
            raise AppError(ErrorCode.NOT_FOUND)
        if job.task is not None and not job.task.done():
            job.task.cancel()
        log.info("url_import_cancelled", extra={"job_id": job_id})

    async def stop(self) -> None:
        tasks = [j.task for j in self._jobs.values() if j.task is not None and not j.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def _forget_old(self) -> None:
        finished = [j for j in self._jobs.values() if j.state is not ImportState.DOWNLOADING]
        for job in finished[: max(0, len(finished) - _KEEP_FINISHED)]:
            self._jobs.pop(job.id, None)

    async def _run(self, job: ImportJob, url: ParsedUrl) -> None:
        try:
            async with asyncio.timeout(self._total_timeout_s):
                job.document = await self._download(job, url)
        except TimeoutError:
            self._fail(job, AppError(ErrorCode.URL_TIMEOUT))
        except AppError as exc:
            self._fail(job, exc)
        except Exception as exc:
            # The type only: messages of HTTP libraries carry the URL, which is personal data.
            # The request id of the start is in the record (the task inherits its context).
            log.error("url_import_failed", extra={"job_id": job.id, "error": type(exc).__name__})
            self._fail(job, AppError(ErrorCode.INTERNAL_ERROR))
        else:
            job.state = ImportState.DONE
            log.info("url_import_done", extra={"job_id": job.id, "bytes": job.received})

    @staticmethod
    def _fail(job: ImportJob, error: AppError) -> None:
        code = _AS_LINK_ERROR.get(error.code, error.code)
        job.state, job.error_code = ImportState.FAILED, code
        job.error_params = dict(error.params)
        log.info("url_import_refused", extra={"job_id": job.id, "code": code.value})

    def _check_name(self, url: ParsedUrl) -> None:
        if host_is_blocked(url.host) or (url.is_ip_literal and not self._is_public(url.host)):
            raise AppError(ErrorCode.URL_BLOCKED)

    async def _vet(self, url: ParsedUrl) -> str:
        """The address to connect to: resolved once, refused unless every answer is public
        (a client library could otherwise pick the private one)."""
        self._check_name(url)
        if url.is_ip_literal:
            return url.host
        addresses = await self._resolver.resolve(url.host, url.port)
        if not addresses:
            raise AppError(ErrorCode.URL_UNREACHABLE)
        if not all(self._is_public(address) for address in addresses):
            raise AppError(ErrorCode.URL_BLOCKED)
        return addresses[0]

    async def _download(self, job: ImportJob, url: ParsedUrl) -> Document:
        for _ in range(MAX_REDIRECTS + 1):
            address = await self._vet(url)
            async with self._fetcher.open(url, address) as response:
                if response.status in _REDIRECTS:
                    location = response.headers.get("location")
                    if not location:
                        status = {"status": response.status}
                        raise AppError(ErrorCode.URL_UNREACHABLE, params=status)
                    url = parse_import_url(urljoin(url.text, location))
                    continue
                if response.status != 200:
                    raise AppError(ErrorCode.URL_UNREACHABLE, params={"status": response.status})
                kind = import_kind(response.headers.get("content-type"), url.target)
                if kind is None:
                    raise AppError(ErrorCode.URL_UNSUPPORTED_TYPE)
                job.total = self._length(response.headers.get("content-length"))
                name = import_file_name(url, response.headers.get("content-disposition"), kind)
                return await self._uploads.accept(
                    name,
                    job.total,
                    self._counted(job, response.body),
                    chat_id=job.chat_id,
                    in_library=job.in_library,
                    source_url=job.url,
                    rate_counted=True,
                )
        raise AppError(ErrorCode.URL_UNREACHABLE, params={"redirects": MAX_REDIRECTS})

    def _length(self, header: str | None) -> int | None:
        if header is None or not header.strip().isdigit():
            return None
        length = int(header)
        if length > self._max_bytes:
            raise AppError(ErrorCode.URL_TOO_LARGE, params={"max_mb": self._max_bytes // 2**20})
        return length or None

    @staticmethod
    async def _counted(job: ImportJob, body: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
        async for chunk in body:
            job.received += len(chunk)
            yield chunk
