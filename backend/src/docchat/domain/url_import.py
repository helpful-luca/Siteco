"""Rules for importing a document from a link (SSRF protection). Pure: no network here.

Only http and https, no credentials in the URL, no local or internal host names, and every
address a name resolves to must be public. The fetcher connects to the vetted address and checks
every redirect hop again.
"""

import ipaddress
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

from docchat.domain.enums import DocumentKind
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.upload_validation import kind_for_filename, sanitize_filename

MAX_URL_CHARS = 2048
MAX_REDIRECTS = 5
_DEFAULT_PORTS = {"http": 80, "https": 443}
_HOST = re.compile(r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*")

# Names that only make sense inside a machine, a home network or Docker. Single labels
# (`backend`, `clamav`, `intranet`) are refused as well: public names have a dot.
_BLOCKED_SUFFIXES = (
    "localhost",
    ".localhost",
    ".local",
    ".localdomain",
    ".internal",  # host.docker.internal, metadata.google.internal
    ".lan",
    ".home",
    ".home.arpa",
    ".intranet",
)

# IPv6 ranges that carry an IPv4 address inside (and so could point back at a private one) or
# are otherwise not plain public unicast. The standard library flags the rest.
_V6_DENY = tuple(
    ipaddress.IPv6Network(n)
    for n in (
        "::/96",  # IPv4-compatible (deprecated)
        "64:ff9b::/96",  # NAT64
        "64:ff9b:1::/48",  # local-use NAT64
        "2001::/32",  # Teredo
        "2002::/16",  # 6to4
        "fec0::/10",  # site-local (deprecated)
    )
)


@dataclass(frozen=True)
class ParsedUrl:
    scheme: str  # http or https
    host: str  # lower case, IDNA (punycode), IPv6 without brackets
    port: int
    target: str  # path and query, never empty; the fragment is dropped
    text: str  # the normalized URL, as stored with the document

    @property
    def is_ip_literal(self) -> bool:
        try:
            ipaddress.ip_address(self.host)
        except ValueError:
            return False
        return True

    @property
    def host_header(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        default = _DEFAULT_PORTS[self.scheme]
        return host if self.port == default else f"{host}:{self.port}"


def _invalid(message: str) -> AppError:
    return AppError(ErrorCode.URL_INVALID, message)


def _ascii_host(raw: str) -> str:
    host = raw.lower().rstrip(".")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return host
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise _invalid("The host name is not valid.") from exc
    if len(host) > 253 or not _HOST.fullmatch(host):
        raise _invalid("The host name is not valid.")
    return host


def parse_import_url(raw: str) -> ParsedUrl:
    """Raises URL_INVALID for anything but a plain http(s) URL without credentials."""
    text = raw.strip()
    if not text or len(text) > MAX_URL_CHARS:
        raise _invalid("The link is empty or too long.")
    if any(ord(c) <= 0x20 or ord(c) == 0x7F for c in text):
        raise _invalid("The link contains spaces or control characters.")
    parts = urlsplit(text)
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise _invalid("Only http and https links can be imported.")
    if "@" in parts.netloc:
        raise _invalid("Links with a user name or password are not accepted.")
    if not parts.hostname:
        raise _invalid("The link has no host.")
    try:
        explicit = parts.port
    except ValueError as exc:
        raise _invalid("The port is not valid.") from exc
    port = _DEFAULT_PORTS[scheme] if explicit is None else explicit
    if not 0 < port < 65536:
        raise _invalid("The port is not valid.")
    host = _ascii_host(parts.hostname)
    target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    url_host = f"[{host}]" if ":" in host else host
    port_part = "" if port == _DEFAULT_PORTS[scheme] else f":{port}"
    return ParsedUrl(scheme, host, port, target, f"{scheme}://{url_host}{port_part}{target}")


def host_is_blocked(host: str) -> bool:
    """Local, home network and Docker names. IP literals are judged by `address_is_public`."""
    name = host.lower().rstrip(".")
    try:
        ipaddress.ip_address(name)
    except ValueError:
        pass
    else:
        return False
    return "." not in name or name.endswith(_BLOCKED_SUFFIXES)


def address_is_public(address: str) -> bool:
    """True only for global unicast addresses: never loopback, private, link-local (cloud
    metadata), CGNAT, multicast, unspecified, reserved or documentation ranges, and never an
    IPv6 form that wraps such an IPv4 address."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return address_is_public(str(ip.ipv4_mapped))
        if any(ip in network for network in _V6_DENY):
            return False
    if (
        ip.is_multicast
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return ip.is_global


_MIME_KINDS = {
    "application/pdf": DocumentKind.PDF,
    "text/html": DocumentKind.HTML,
    "application/xhtml+xml": DocumentKind.HTML,
    "text/markdown": DocumentKind.MD,
    "text/x-markdown": DocumentKind.MD,
}
# Types that say nothing about the content: the path's extension decides.
_UNSPECIFIC = frozenset(
    {"", "application/octet-stream", "binary/octet-stream", "application/force-download",
     "application/x-download", "application/download"}
)  # fmt: skip
_EXTENSIONS = {
    DocumentKind.PDF: ".pdf",
    DocumentKind.HTML: ".html",
    DocumentKind.TXT: ".txt",
    DocumentKind.MD: ".md",
}


def _last_segment(target: str) -> str:
    path = target.split("?", 1)[0]
    segments = [s for s in path.split("/") if s]
    return unquote(segments[-1]) if segments else ""


def import_kind(content_type: str | None, target: str) -> DocumentKind | None:
    """What the response is, from its Content-Type, else from the path. The upload checks then
    verify the bytes (magic, markup) like for any upload."""
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    by_path = kind_for_filename(_last_segment(target))
    if mime in _MIME_KINDS:
        return _MIME_KINDS[mime]
    if mime == "text/plain":
        return DocumentKind.MD if by_path is DocumentKind.MD else DocumentKind.TXT
    if mime in _UNSPECIFIC:
        return by_path
    return None


_DISPOSITION_STAR = re.compile(r"filename\*\s*=\s*([^']*)'[^']*'([^;]+)", re.IGNORECASE)
_DISPOSITION = re.compile(r'filename\s*=\s*(?:"([^"]*)"|([^;]+))', re.IGNORECASE)


def _disposition_name(header: str | None) -> str:
    if not header:
        return ""
    star = _DISPOSITION_STAR.search(header)
    if star:
        try:
            return unquote(star.group(2).strip(), encoding=star.group(1) or "utf-8")
        except LookupError:
            return ""
    plain = _DISPOSITION.search(header)
    if plain:
        return (plain.group(1) or plain.group(2) or "").strip()
    return ""


def import_file_name(url: ParsedUrl, disposition: str | None, kind: DocumentKind) -> str:
    """Display name: Content-Disposition, else the last path segment, else the host; always
    with the extension of the kind, so the upload checks treat it as that kind."""
    raw = _disposition_name(disposition) or _last_segment(url.target) or url.host
    name = sanitize_filename(raw)
    if kind_for_filename(name) is not kind:
        name = sanitize_filename(name + _EXTENSIONS[kind])
    return name


@dataclass(frozen=True)
class FetchedResponse:
    """One HTTP response as the import sees it. Header names are lower case."""

    status: int
    headers: Mapping[str, str]
    body: AsyncIterator[bytes]
