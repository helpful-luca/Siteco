"""The single preferences row, stored as JSON (annex 11, 2.2)."""

import json
from dataclasses import asdict
from datetime import datetime

from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.timestamps import to_db
from docchat.domain.enums import AnswerStyle, Effort, Locale, Theme
from docchat.domain.preferences import Preferences


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("retention_days must be an integer")
    return value


class SqlitePreferencesStore:
    def __init__(self, database: Database) -> None:
        self._db = database

    def load(self) -> Preferences | None:
        """None when nothing is stored or the row cannot be read (the defaults apply then)."""
        with self._db.connect() as conn:
            row = conn.execute("SELECT data FROM preferences WHERE id = 1").fetchone()
        if row is None:
            return None
        try:
            data = json.loads(row[0])
            first, second = data["compare_models"]
            return Preferences(
                locale=Locale(data["locale"]),
                theme=Theme(data["theme"]),
                name=str(data["name"]),
                default_model=str(data["default_model"]),
                effort=Effort(data["effort"]),
                style=AnswerStyle(data["style"]),
                compare_models=(str(first), str(second)),
                onboarded=bool(data["onboarded"]),
                # Rows saved before the setting existed have none: the default applies.
                retention_days=_optional_int(data.get("retention_days")),
            )
        except (ValueError, KeyError, TypeError):
            return None

    def save(self, preferences: Preferences, now: datetime) -> None:
        data = json.dumps(asdict(preferences), ensure_ascii=False)
        with self._db.connect() as conn:
            conn.execute(
                "INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET data = excluded.data,"
                " updated_at = excluded.updated_at",
                (data, to_db(now)),
            )

    def clear(self) -> None:
        with self._db.connect() as conn:
            conn.execute("DELETE FROM preferences")
