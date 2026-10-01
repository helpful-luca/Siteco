"""HTTP for the link import: one request to an address that was already vetted.

The request goes to the IP itself, with the original host in the Host header and as the TLS
server name (SNI and certificate check), so DNS is never asked again (no rebinding). A fresh
client per request: no cookies carried between hops, no connection reuse across host names,
no proxy or credentials from the environment, never following redirects on its own."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx2

from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.url_import import FetchedResponse, ParsedUrl

USER_AGENT = "SitecoDocChat/1.0 (document import on behalf of a user; no crawling)"
_ACCEPT = "application/pdf, text/html;q=0.9, text/markdown;q=0.9, text/plain;q=0.8"


def _link_error(exc: Exception) -> AppError:
    if isinstance(exc, httpx2.TimeoutException):
        return AppError(ErrorCode.URL_TIMEOUT)
    return AppError(ErrorCode.URL_UNREACHABLE)


class HttpUrlFetcher:
    def __init__(
        self,
        *,
        connect_timeout_s: float = 10.0,
        read_timeout_s: float = 30.0,
        transport: httpx2.AsyncBaseTransport | None = None,  # tests: a mock transport
    ) -> None:
        self._timeout = httpx2.Timeout(read_timeout_s, connect=connect_timeout_s)
        self._transport = transport

    @asynccontextmanager
    async def open(self, url: ParsedUrl, address: str) -> AsyncIterator[FetchedResponse]:
        ip_host = f"[{address}]" if ":" in address else address
        request_url = f"{url.scheme}://{ip_host}:{url.port}{url.target}"
        extensions = {"sni_hostname": url.host} if url.scheme == "https" else {}
        async with httpx2.AsyncClient(
            timeout=self._timeout,
            follow_redirects=False,
            trust_env=False,  # no HTTP(S)_PROXY, no .netrc credentials
            transport=self._transport,
        ) as client:
            request = client.build_request(
                "GET",
                request_url,
                headers={
                    "Host": url.host_header,
                    "User-Agent": USER_AGENT,
                    "Accept": _ACCEPT,
                    "Accept-Encoding": "identity",
                },
                extensions=extensions,
            )
            try:
                response = await client.send(request, stream=True)
            except httpx2.HTTPError as exc:
                raise _link_error(exc) from exc
            try:
                headers = {k.lower(): v for k, v in response.headers.items()}
                yield FetchedResponse(response.status_code, headers, self._body(response))
            finally:
                await response.aclose()

    @staticmethod
    async def _body(response: httpx2.Response) -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        except httpx2.HTTPError as exc:
            raise _link_error(exc) from exc
