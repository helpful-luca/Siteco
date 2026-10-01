"""Reads the eval result files from a folder (`/app/eval` in the image, `eval/results` in a
checkout). Never raises for a missing or broken file: the Quality page then shows its empty
state (annex 10, N2 and N4)."""

import json
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

log = logging.getLogger("docchat.eval")


class JsonEvalResults:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def read(self, name: str) -> Mapping[str, Any] | None:
        path = self.directory / f"{name}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            log.warning("eval_results_unreadable", extra={"file": path.name})
            return None
        return data if isinstance(data, dict) else None
