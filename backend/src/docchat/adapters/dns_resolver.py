"""Name resolution for the link import, with its own timeout."""

import asyncio
import socket

from docchat.domain.errors import AppError, ErrorCode

_TIMEOUT_S = 10.0


class SystemHostResolver:
    async def resolve(self, host: str, port: int) -> list[str]:
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout(_TIMEOUT_S):
                infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except TimeoutError as exc:
            raise AppError(ErrorCode.URL_TIMEOUT) from exc
        except (socket.gaierror, UnicodeError, OSError) as exc:
            raise AppError(ErrorCode.URL_UNREACHABLE) from exc
        addresses: list[str] = []
        for _family, _type, _proto, _name, sockaddr in infos:
            # IPv6 link-local answers carry a zone ("fe80::1%en0"): judged without it.
            address = str(sockaddr[0]).split("%", 1)[0]
            if address not in addresses:
                addresses.append(address)
        return addresses
