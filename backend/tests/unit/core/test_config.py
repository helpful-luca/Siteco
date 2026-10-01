from pathlib import Path

import pytest

from docchat.adapters.clamd_scanner import ClamdScanner
from docchat.core.config import Settings
from docchat.core.container import build_container
from tests.fakes import FakeEmbedder


def test_defaults_work_without_any_environment() -> None:
    s = Settings(_env_file=None)
    assert s.anthropic_api_key is None
    assert s.llm_provider == "anthropic"
    assert s.embedding_model == "ibm-granite/granite-embedding-97m-multilingual-r2"


def test_empty_key_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "   ")
    assert Settings(_env_file=None).anthropic_api_key is None


def test_chat_defaults_follow_the_spec() -> None:
    s = Settings(_env_file=None)
    assert s.default_model == "claude-sonnet-5-5"
    assert (s.top_k, s.retrieval_candidates, s.per_document_cap) == (8, 20, 5)
    assert (s.history_max_turns, s.full_context_max_tokens) == (6, 50_000)
    assert s.daily_budget_usd is None  # no budget unless configured


def test_empty_budget_means_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_BUDGET_USD", "")
    assert Settings(_env_file=None).daily_budget_usd is None
    monkeypatch.setenv("DAILY_BUDGET_USD", "2.5")
    assert Settings(_env_file=None).daily_budget_usd == 2.5


def test_ocr_is_on_by_default_with_german_and_english(monkeypatch: pytest.MonkeyPatch) -> None:
    s = Settings(_env_file=None)
    assert (s.ocr, s.ocr_languages, s.ocr_page_timeout_s) == ("on", "deu+eng", 60)
    monkeypatch.setenv("OCR", "off")
    assert Settings(_env_file=None).ocr == "off"


def test_the_malware_scan_cannot_be_switched_off(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """There is no `MALWARE_SCAN=off` any more: the app always wires clamd."""
    monkeypatch.setenv("MALWARE_SCAN", "off")
    settings = Settings(_env_file=None, data_dir=tmp_path, ocr="off")
    assert not hasattr(settings, "malware_scan")
    container = build_container(settings, embedder=FakeEmbedder())
    assert isinstance(container.scans.scanner, ClamdScanner)
