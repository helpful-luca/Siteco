"""Import from a link: every hop vetted, the vetted address used, then the upload path."""

import asyncio
from pathlib import Path

import pytest

from docchat.domain.enums import DocumentKind, DocumentStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.url_import_service import ImportState, UrlImportService
from tests.fakes import FakeFetcher, FakeResolver
from tests.pdf_factory import build_pdf, text_page
from tests.services.conftest import Harness, build_harness

PDF = build_pdf([text_page("Die Leuchte hat IP66.")])
PUBLIC = "93.184.215.14"
CATALOG = "https://www.siteco.de/fileadmin/SIT_KAT_DE_2026.pdf?_=1789028675"


def importer(
    harness: Harness,
    routes: dict[str, tuple[int, dict[str, str], list[bytes]]],
    dns: dict[str, list[str]] | None = None,
) -> tuple[UrlImportService, FakeResolver, FakeFetcher]:
    resolver = FakeResolver(dns if dns is not None else {"www.siteco.de": [PUBLIC]})
    fetcher = FakeFetcher(routes)
    service = UrlImportService(
        harness.uploads, resolver, fetcher, max_bytes=5 * 1024 * 1024, total_timeout_s=30
    )
    return service, resolver, fetcher


async def finished(service: UrlImportService, job_id: str) -> None:
    for _ in range(200):
        job = service.get(job_id)
        if job.state is not ImportState.DOWNLOADING:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("import did not finish")


def pdf_route(chunks: list[bytes] | None = None) -> tuple[int, dict[str, str], list[bytes]]:
    return (
        200,
        {"Content-Type": "application/pdf", "Content-Length": str(len(PDF))},
        (chunks or [PDF[:300], PDF[300:]]),
    )


async def test_a_pdf_link_goes_through_the_upload_path(harness: Harness) -> None:
    service, resolver, fetcher = importer(harness, {CATALOG: pdf_route()})
    job = service.start(CATALOG, library=True, chat_id=None)
    await finished(service, job.id)
    job = service.get(job.id)
    assert job.state is ImportState.DONE and job.document is not None
    document = job.document
    assert (document.filename, document.kind, document.status) == (
        "SIT_KAT_DE_2026.pdf", DocumentKind.PDF, DocumentStatus.SCANNING,
    )  # fmt: skip
    assert document.source_url == CATALOG and document.in_library
    assert (job.received, job.total) == (len(PDF), len(PDF))
    assert fetcher.requests == [(CATALOG, PUBLIC)]  # connected to the vetted address
    assert resolver.lookups == ["www.siteco.de"]


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("ftp://www.siteco.de/a.pdf", ErrorCode.URL_INVALID),
        ("https://user:pw@www.siteco.de/a.pdf", ErrorCode.URL_INVALID),
        ("http://127.0.0.1:8000/api/documents", ErrorCode.URL_BLOCKED),
        ("http://[::ffff:169.254.169.254]/latest/meta-data/", ErrorCode.URL_BLOCKED),
        ("http://backend:8000/api/health/ready", ErrorCode.URL_BLOCKED),
        ("http://clamav:3310/", ErrorCode.URL_BLOCKED),
        ("http://localhost:3000/", ErrorCode.URL_BLOCKED),
    ],
)
async def test_refused_before_anything_is_fetched(
    harness: Harness, url: str, code: ErrorCode
) -> None:
    service, resolver, fetcher = importer(harness, {})
    with pytest.raises(AppError) as caught:
        service.start(url, library=True, chat_id=None)
    assert caught.value.code is code
    assert resolver.lookups == [] and fetcher.requests == []


async def test_a_name_that_resolves_to_a_private_address_is_blocked(harness: Harness) -> None:
    url = "https://intern.example.com/x.pdf"
    # One public and one private answer: refused, a client could pick either.
    service, _, fetcher = importer(
        harness, {url: pdf_route()}, {"intern.example.com": [PUBLIC, "10.0.0.5"]}
    )
    job = service.start(url, library=True, chat_id=None)
    await finished(service, job.id)
    assert service.get(job.id).error_code is ErrorCode.URL_BLOCKED
    assert fetcher.requests == []


async def test_every_redirect_hop_is_checked_again(harness: Harness) -> None:
    start = "https://www.siteco.de/go"
    routes = {start: (302, {"Location": "http://169.254.169.254/latest/meta-data/"}, [])}
    service, _, fetcher = importer(harness, routes)
    job = service.start(start, library=True, chat_id=None)
    await finished(service, job.id)
    assert service.get(job.id).error_code is ErrorCode.URL_BLOCKED
    assert fetcher.requests == [(start, PUBLIC)]


async def test_a_redirect_to_a_name_with_a_private_address_is_blocked(harness: Harness) -> None:
    start = "https://www.siteco.de/go"
    routes = {start: (301, {"Location": "https://cdn.example.net/a.pdf"}, [])}
    dns = {"www.siteco.de": [PUBLIC], "cdn.example.net": ["192.168.1.10"]}
    service, _, fetcher = importer(harness, routes, dns)
    job = service.start(start, library=True, chat_id=None)
    await finished(service, job.id)
    assert service.get(job.id).error_code is ErrorCode.URL_BLOCKED
    assert len(fetcher.requests) == 1


async def test_relative_redirects_are_followed_up_to_five_hops(harness: Harness) -> None:
    base = "https://www.siteco.de/"
    routes = {f"{base}{i}": (307, {"Location": f"/{i + 1}"}, []) for i in range(6)}
    routes[f"{base}3"] = (308, {"Location": "/final.pdf"}, [])
    routes[f"{base}final.pdf"] = pdf_route()
    service, _, fetcher = importer(harness, routes)
    job = service.start(f"{base}0", library=True, chat_id=None)
    await finished(service, job.id)
    assert service.get(job.id).state is ImportState.DONE
    assert len(fetcher.requests) == 5
    endless, _, _ = importer(harness, {f"{base}{i}": (302, {"Location": f"/{i + 1}"}, [])
                                      for i in range(10)})  # fmt: skip
    job = endless.start(f"{base}0", library=True, chat_id=None)
    await finished(endless, job.id)
    assert endless.get(job.id).error_code is ErrorCode.URL_UNREACHABLE


async def test_dns_rebinding_cannot_reach_the_network(harness: Harness) -> None:
    """The name is resolved once per hop and the connection goes to that vetted address,
    whatever the name resolves to a moment later."""

    class Rebinding(FakeResolver):
        async def resolve(self, host: str, port: int) -> list[str]:
            self.lookups.append(host)
            return [PUBLIC] if len(self.lookups) == 1 else ["127.0.0.1"]

    service, _, fetcher = importer(harness, {CATALOG: pdf_route()})
    service._resolver = Rebinding({})
    job = service.start(CATALOG, library=True, chat_id=None)
    await finished(service, job.id)
    assert fetcher.requests == [(CATALOG, PUBLIC)]
    assert service.get(job.id).state is ImportState.DONE


@pytest.mark.parametrize(
    ("headers", "body", "code"),
    [
        ({"Content-Type": "image/png"}, [b"\x89PNG"], ErrorCode.URL_UNSUPPORTED_TYPE),
        ({"Content-Type": "application/pdf"}, [b"MZ" + b"\0" * 2000],
         ErrorCode.URL_UNSUPPORTED_TYPE),
        ({"Content-Type": "text/html"}, [b"just text, no markup"], ErrorCode.URL_UNSUPPORTED_TYPE),
        ({"Content-Type": "application/pdf", "Content-Length": str(6 * 1024 * 1024)}, [b"%PDF"],
         ErrorCode.URL_TOO_LARGE),
        ({"Content-Type": "application/pdf"}, [b"%PDF-1.7 " + b"x" * (6 * 1024 * 1024)],
         ErrorCode.URL_TOO_LARGE),
    ],
)  # fmt: skip
async def test_wrong_or_oversized_content_fails_with_a_link_error(
    harness: Harness, headers: dict[str, str], body: list[bytes], code: ErrorCode
) -> None:
    service, _, _ = importer(harness, {CATALOG: (200, headers, body)})
    job = service.start(CATALOG, library=True, chat_id=None)
    await finished(service, job.id)
    assert service.get(job.id).error_code is code
    assert harness.repository.list_visible() == []
    assert list((harness.root / "uploads" / "tmp").glob("*")) == []


async def test_an_error_status_is_unreachable(harness: Harness) -> None:
    service, _, _ = importer(harness, {CATALOG: (404, {}, [b"not found"])})
    job = service.start(CATALOG, library=True, chat_id=None)
    await finished(service, job.id)
    job = service.get(job.id)
    assert (job.error_code, job.error_params) == (ErrorCode.URL_UNREACHABLE, {"status": 404})


async def test_an_html_page_without_length_into_a_chat(harness: Harness) -> None:
    with harness.database.connect() as conn:
        conn.execute("INSERT INTO chats (id, created_at, updated_at) VALUES ('c1', 't', 't')")
    page = "https://www.siteco.de/de/produkte/"
    html = b"<!DOCTYPE html><html><body><h1>Produkte</h1><p>Mira L</p></body></html>"
    routes = {page: (200, {"Content-Type": "text/html; charset=utf-8"}, [html])}
    service, _, _ = importer(harness, routes)
    job = service.start(page, library=False, chat_id="c1")
    await finished(service, job.id)
    document = service.get(job.id).document
    assert document is not None
    assert (document.filename, document.kind, document.in_library) == (
        "produkte.html", DocumentKind.HTML, False,
    )  # fmt: skip
    assert [d.id for d in harness.repository.list_attachments("c1")] == [document.id]
    assert service.get(job.id).total is None


async def test_a_running_import_can_be_cancelled(harness: Harness) -> None:
    started = asyncio.Event()

    class Slow(FakeFetcher):
        def open(self, url, address):  # type: ignore[no-untyped-def]
            started.set()
            return super().open(url, address)

    service, _, _ = importer(harness, {})
    service._fetcher = Slow({CATALOG: pdf_route([PDF[:10]] + [PDF[10:]] * 0)})
    job = service.start(CATALOG, library=True, chat_id=None)
    service.cancel(job.id)
    await asyncio.sleep(0.05)
    with pytest.raises(AppError) as caught:
        service.get(job.id)
    assert caught.value.code is ErrorCode.NOT_FOUND
    assert harness.repository.list_visible() == []


def test_unknown_jobs_are_not_found(tmp_path: Path) -> None:
    service, _, _ = importer(build_harness(tmp_path), {})
    with pytest.raises(AppError) as caught:
        service.get("nope")
    assert caught.value.code is ErrorCode.NOT_FOUND
