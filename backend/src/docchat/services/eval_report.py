"""The retrieval eval results for the Quality page (annex 11, 8.9). There is no "run eval" in
the app: it takes CPU minutes and its own data (annex 10, N5); `make eval` writes the file."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import EvalResultsReader


@dataclass(frozen=True)
class EvalReport:
    latest: Mapping[str, Any]
    generation: Mapping[str, Any] | None
    stale: bool  # measured with other retrieval settings than the running ones


class EvalReportService:
    def __init__(self, reader: EvalResultsReader, config_hash: str) -> None:
        self._reader = reader
        self._config_hash = config_hash

    def report(self) -> EvalReport:
        """Raises EVAL_RESULTS_MISSING without a results file."""
        latest = self._reader.read("latest")
        if latest is None:
            raise AppError(ErrorCode.EVAL_RESULTS_MISSING)
        return EvalReport(
            latest=latest,
            generation=self._reader.read("generation"),
            stale=latest.get("config_hash") != self._config_hash,
        )
