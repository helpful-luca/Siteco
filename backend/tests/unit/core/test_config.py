import pytest

from docchat.core.config import Settings


def test_defaults_work_without_any_environment() -> None:
    s = Settings(_env_file=None)
    assert s.anthropic_api_key is None
    assert s.llm_provider == "anthropic"
    assert s.embedding_model == "ibm-granite/granite-embedding-97m-multilingual-r2"


def test_empty_key_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "   ")
    assert Settings(_env_file=None).anthropic_api_key is None


def test_llm_key_configured_reflects_key() -> None:
    assert Settings(_env_file=None).llm_key_configured is False
    assert Settings(_env_file=None, anthropic_api_key="sk-ant-x").llm_key_configured is True


def test_chat_defaults_follow_the_spec() -> None:
    s = Settings(_env_file=None)
    assert s.default_model == "claude-sonnet-5-5"
    assert (s.top_k, s.retrieval_candidates, s.per_document_cap) == (8, 20, 5)
    assert (s.history_max_turns, s.full_context_max_tokens) == (6, 20_000)
    assert s.daily_budget_usd is None  # no budget unless configured


def test_empty_budget_means_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DAILY_BUDGET_USD", "")
    assert Settings(_env_file=None).daily_budget_usd is None
    monkeypatch.setenv("DAILY_BUDGET_USD", "2.5")
    assert Settings(_env_file=None).daily_budget_usd == 2.5
