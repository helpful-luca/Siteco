"""The link import's address policy and URL rules: the server must never be made to reach
into this machine, the local network, Docker's internal names or cloud metadata."""

import pytest

from docchat.domain.enums import DocumentKind
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.url_import import (
    address_is_public,
    host_is_blocked,
    import_file_name,
    import_kind,
    parse_import_url,
)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",  # loopback
        "127.255.255.254",
        "10.0.0.1",  # private
        "172.16.5.4",
        "192.168.178.1",
        "169.254.169.254",  # link-local, AWS/GCP/Azure metadata
        "100.64.0.1",  # CGNAT (shared address space)
        "100.100.100.200",  # Alibaba metadata, inside CGNAT
        "0.0.0.0",  # unspecified
        "0.1.2.3",  # "this network"
        "224.0.0.1",  # multicast
        "239.255.255.250",
        "255.255.255.255",  # broadcast
        "192.0.0.8",  # IETF protocol assignments
        "192.0.2.10",  # documentation
        "198.18.0.1",  # benchmarking
        "240.0.0.1",  # reserved
        "::1",  # IPv6 loopback
        "::",  # unspecified
        "fe80::1",  # link-local
        "fc00::1",  # unique local
        "fd00:ec2::254",  # AWS metadata over IPv6 (ULA)
        "ff02::1",  # multicast
        "fec0::1",  # site-local (deprecated)
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
        "::ffff:10.1.2.3",  # IPv4-mapped private
        "::ffff:169.254.169.254",
        "::127.0.0.1",  # IPv4-compatible (deprecated)
        "64:ff9b::a00:1",  # NAT64 of 10.0.0.1
        "2002:a00:1::1",  # 6to4 of 10.0.0.1
        "2001::1",  # Teredo
        "2001:db8::1",  # documentation
    ],
)
def test_internal_and_special_addresses_are_refused(address: str) -> None:
    assert not address_is_public(address)


@pytest.mark.parametrize(
    "address", ["93.184.215.14", "8.8.8.8", "2a00:1450:4001:82a::2004", "2606:4700::6810:84e5"]
)
def test_public_addresses_are_allowed(address: str) -> None:
    assert address_is_public(address)


def test_garbage_is_not_an_address() -> None:
    assert not address_is_public("not an ip")


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "LOCALHOST",
        "api.localhost",
        "backend",
        "frontend",
        "clamav",
        "host.docker.internal",
        "metadata.google.internal",
        "router.local",
        "intranet",  # single label: a local name
        "printer.lan",
        "nas.home.arpa",
    ],
)
def test_local_and_docker_names_are_refused(host: str) -> None:
    assert host_is_blocked(host)


@pytest.mark.parametrize("host", ["www.siteco.de", "example.com", "xn--bcher-kva.example"])
def test_public_names_pass(host: str) -> None:
    assert not host_is_blocked(host)


def test_a_url_is_parsed_into_what_the_fetcher_needs() -> None:
    url = parse_import_url(
        "https://www.Siteco.de/fileadmin/Kataloge/SIT_KAT_DE_2026.pdf?_=1789028675#seite-4"
    )
    assert (url.scheme, url.host, url.port) == ("https", "www.siteco.de", 443)
    assert url.target == "/fileadmin/Kataloge/SIT_KAT_DE_2026.pdf?_=1789028675"
    assert url.text == "https://www.siteco.de/fileadmin/Kataloge/SIT_KAT_DE_2026.pdf?_=1789028675"
    assert parse_import_url("http://example.com:8080").target == "/"
    assert parse_import_url("https://[2606:4700::1]/a").host == "2606:4700::1"
    assert parse_import_url("https://bücher.example/").host == "xn--bcher-kva.example"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "example.com/datei.pdf",  # no scheme
        "ftp://example.com/a.pdf",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://",
        "https://user:secret@example.com/a.pdf",  # credentials
        "https://user@example.com/a.pdf",
        "https://example.com:0/",
        "https://example.com:99999/",
        "https://exa mple.com/",
        "https://example.com/\x00",
        "https://example.com/" + "a" * 3000,
    ],
)
def test_invalid_urls(raw: str) -> None:
    with pytest.raises(AppError) as caught:
        parse_import_url(raw)
    assert caught.value.code is ErrorCode.URL_INVALID


@pytest.mark.parametrize(
    ("content_type", "path", "kind"),
    [
        ("application/pdf", "/x", DocumentKind.PDF),
        ("text/html; charset=utf-8", "/", DocumentKind.HTML),
        ("application/xhtml+xml", "/a", DocumentKind.HTML),
        ("text/plain", "/notes", DocumentKind.TXT),
        ("text/markdown", "/README", DocumentKind.MD),
        ("application/octet-stream", "/katalog.pdf", DocumentKind.PDF),
        (None, "/readme.md", DocumentKind.MD),
        ("text/plain", "/readme.md", DocumentKind.MD),  # servers send markdown as text/plain
        ("image/png", "/bild.png", None),
        ("application/zip", "/katalog.pdf", None),  # a declared type that is not ours wins
    ],
)
def test_the_kind_comes_from_the_content_type_then_the_path(
    content_type: str | None, path: str, kind: DocumentKind | None
) -> None:
    assert import_kind(content_type, path) is kind


def test_file_names_from_the_disposition_or_the_path_with_the_right_extension() -> None:
    url = parse_import_url("https://www.siteco.de/fileadmin/SIT_KAT_DE_2026.pdf?_=1")
    assert import_file_name(url, None, DocumentKind.PDF) == "SIT_KAT_DE_2026.pdf"
    disposition = "attachment; filename*=UTF-8''Katalog%20%C3%BCbersicht.pdf"
    assert import_file_name(url, disposition, DocumentKind.PDF) == "Katalog übersicht.pdf"
    assert import_file_name(url, 'inline; filename="../../etc/x.pdf"', DocumentKind.PDF) == "x.pdf"
    page = parse_import_url("https://www.siteco.de/de/produkte/")
    assert import_file_name(page, None, DocumentKind.HTML) == "produkte.html"
    home = parse_import_url("https://www.siteco.de/")
    assert import_file_name(home, None, DocumentKind.HTML) == "www.siteco.de.html"
    odd = parse_import_url("https://example.com/download.php?id=4")
    assert import_file_name(odd, None, DocumentKind.PDF) == "download.php.pdf"
