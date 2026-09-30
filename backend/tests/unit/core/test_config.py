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
