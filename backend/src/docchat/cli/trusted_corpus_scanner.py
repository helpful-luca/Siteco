"""Scanner for the eval runners only: their corpus is our own, checksummed files.

The app has no way to skip the malware scan; this is passed to `build_container` explicitly
by `run_eval` and `run_generation_eval`, which run where no clamd exists (CI, a laptop)."""

from pathlib import Path

from docchat.domain.malware import ScanVerdict


class TrustedCorpusScanner:
    async def scan(self, path: Path) -> ScanVerdict:
        return ScanVerdict()
