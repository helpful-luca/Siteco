"""Cost and tokens per UTC day. No foreign keys: deleting chats does not reset the day."""

from docchat.adapters.sqlite.database import Database


class SqliteUsageLedger:
    def __init__(self, database: Database) -> None:
        self._db = database

    def record(self, day: str, cost_usd: float, input_tokens: int, output_tokens: int) -> None:
        with self._db.connect() as conn:
            conn.execute(
                "INSERT INTO usage_ledger (day, cost_usd, input_tokens, output_tokens, requests)"
                " VALUES (?, ?, ?, ?, 1)"
                " ON CONFLICT(day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd,"
                " input_tokens = input_tokens + excluded.input_tokens,"
                " output_tokens = output_tokens + excluded.output_tokens,"
                " requests = requests + 1",
                (day, cost_usd, input_tokens, output_tokens),
            )

    def cost_on(self, day: str) -> float:
        with self._db.connect() as conn:
            row = conn.execute("SELECT cost_usd FROM usage_ledger WHERE day = ?", (day,)).fetchone()
        return float(row[0]) if row else 0.0
