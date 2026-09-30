"""Checks a `Range` header before Starlette's FileResponse serves it, so that invalid ranges get
the error envelope instead of a plain text body."""

from docchat.domain.errors import AppError, ErrorCode

_MAX_RANGES = 100


def _invalid() -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        "Malformed Range header.",
        details=[{"loc": ["header", "range"], "type": "value_error"}],
    )


def check_range(header: str | None, size: int) -> None:
    if header is None:
        return
    unit, _, spec = header.partition("=")
    parts = spec.split(",")
    if unit.strip().lower() != "bytes" or not spec.strip() or len(parts) > _MAX_RANGES:
        raise _invalid()
    for part in parts:
        first, dash, last = part.strip().partition("-")
        if not dash or not (first.isdigit() or last.isdigit()):
            raise _invalid()
        if (first and not first.isdigit()) or (last and not last.isdigit()):
            raise _invalid()
        if first and last and int(last) < int(first):
            raise _invalid()
        unsatisfiable = int(first) >= size if first else int(last) == 0
        if unsatisfiable:
            raise AppError(ErrorCode.RANGE_NOT_SATISFIABLE, params={"size": size})
