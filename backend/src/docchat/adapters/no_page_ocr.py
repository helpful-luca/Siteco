"""Placeholder until Tesseract is wired in (phase 5b): pages without text stay without text."""

from collections.abc import Sequence
from pathlib import Path

from docchat.domain.parsing import TextSection


class NoPageOcr:
    async def recognize(self, path: Path, pages: Sequence[int]) -> list[TextSection]:
        return []
