"""The fetcher talks to the vetted address with the real host name for Host and TLS."""

import httpx2
import pytest

from docchat.adapters.http_url_fetcher import HttpUrlFetcher
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.url_import import parse_import_url


async def test_the_request_goes_to_the_vetted_address_with_the_real_host() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(302, headers={"Location": "/next", "Set-Cookie": "a=b"})

    fetcher = HttpUrlFetcher(transport=httpx2.MockTransport(handler))
    url = parse_import_url("https://www.siteco.de/kat.pdf?_=1")
    async with fetcher.open(url, "93.184.215.14") as response:
        assert response.status == 302  # redirects are the caller's job
        assert response.headers["location"] == "/next"
    [request] = seen
    assert str(request.url) == "https://93.184.215.14/kat.pdf?_=1"
    assert request.headers["host"] == "www.siteco.de"
    assert request.extensions["sni_hostname"] == "www.siteco.de"
    assert "cookie" not in request.headers and "authorization" not in request.headers
    assert request.headers["user-agent"].startswith("SitecoDocChat/")


async def test_ipv6_addresses_and_ports() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, content=b"ok")

    fetcher = HttpUrlFetcher(transport=httpx2.MockTransport(handler))
    url = parse_import_url("http://example.com:8080/a")
    async with fetcher.open(url, "2606:4700::1") as response:
        assert [c async for c in response.body] == [b"ok"]
    assert str(seen[0].url) == "http://[2606:4700::1]:8080/a"
    assert seen[0].headers["host"] == "example.com:8080"
    assert "sni_hostname" not in seen[0].extensions


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (httpx2.ConnectTimeout("slow"), ErrorCode.URL_TIMEOUT),
        (httpx2.ConnectError("refused"), ErrorCode.URL_UNREACHABLE),
    ],
)
async def test_transport_errors_become_link_errors(error: Exception, code: ErrorCode) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    fetcher = HttpUrlFetcher(transport=httpx2.MockTransport(handler))
    with pytest.raises(AppError) as caught:
        async with fetcher.open(parse_import_url("https://example.com/"), "93.184.215.14"):
            pass
    assert caught.value.code is code
