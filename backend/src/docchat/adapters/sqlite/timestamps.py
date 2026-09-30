"""Timestamps are stored as ISO 8601 UTC strings with microseconds, so they sort as text."""

from datetime import UTC, datetime


def to_db(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def from_db(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None
