"""The Claude key from Settings: stored server-side, checked, swapped in without a restart."""

import asyncio
import logging
from pathlib import Path

import pytest

from docchat.adapters.fake_llm import FakeLLMClient
from docchat.adapters.file_secret_store import FileSecretStore
from docchat.domain.api_key import KeyCheck, KeySource
from docchat.domain.enums import LlmStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import LLMClient
from docchat.services.api_key_service import ApiKeyService
from docchat.services.llm_health import LlmHealth
from docchat.services.swappable_llm import SwappableLLM
from tests.fakes import FakeKeyValidator

GOOD = "sk-ant-api03-" + "a" * 40 + "Wx9Z"
BAD = "sk-ant-api03-" + "b" * 40 + "Bad1"
OFFLINE = "sk-ant-api03-" + "c" * 40 + "Off1"
ENV = "sk-ant-api03-" + "e" * 40 + "Env7"


class ClosableFake(FakeLLMClient):
    def __init__(self) -> None:
        super().__init__()
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class Built:
    def __init__(self) -> None:
        self.keys: list[str] = []
        self.clients: list[ClosableFake] = []

    def __call__(self, key: str) -> LLMClient:
        self.keys.append(key)
        self.clients.append(ClosableFake())
        return self.clients[-1]


def service(
    tmp_path: Path, *, env: str | None = None
) -> tuple[ApiKeyService, LlmHealth, SwappableLLM, Built, FileSecretStore]:
    store = FileSecretStore(tmp_path / "secrets" / "anthropic_api_key")
    health = LlmHealth(LlmStatus.MISSING_KEY)
    llm = SwappableLLM()
    built = Built()
    validator = FakeKeyValidator({BAD: KeyCheck.INVALID, OFFLINE: KeyCheck.UNREACHABLE})
    keys = ApiKeyService(store, validator, health, llm, built, env_key=env)
    keys.load()
    return keys, health, llm, built, store


def test_without_any_key_answers_are_retrieval_only(tmp_path: Path) -> None:
    keys, health, llm, _, _ = service(tmp_path)
    state = keys.state()
    assert (state.configured, state.source, state.suffix) == (False, None, None)
    assert health.status is LlmStatus.MISSING_KEY and llm.current is None


def test_the_environment_key_is_the_fallback(tmp_path: Path) -> None:
    keys, health, _, built, _ = service(tmp_path, env=ENV)
    state = keys.state()
    assert (state.configured, state.source, state.suffix) == (True, KeySource.ENV, "Env7")
    assert health.status is LlmStatus.UNCHECKED and built.keys == [ENV]


async def test_a_valid_key_from_settings_wins_at_once(tmp_path: Path) -> None:
    keys, health, llm, built, store = service(tmp_path, env=ENV)
    state = await keys.save(f"  {GOOD}\n")
    assert (state.source, state.suffix, state.status) == (KeySource.SETTINGS, "Wx9Z", LlmStatus.OK)
    assert store.load() == GOOD and built.keys[-1] == GOOD
    assert health.available and llm.current is not None


async def test_a_rejected_key_is_not_stored(tmp_path: Path) -> None:
    keys, _, _, built, store = service(tmp_path, env=ENV)
    with pytest.raises(AppError) as caught:
        await keys.save(BAD)
    assert caught.value.code is ErrorCode.API_KEY_INVALID
    assert store.load() is None and built.keys == [ENV]
    assert keys.state().source is KeySource.ENV


async def test_a_key_that_cannot_be_checked_now_is_kept_unchecked(tmp_path: Path) -> None:
    keys, health, _, _, store = service(tmp_path)
    state = await keys.save(OFFLINE)
    assert state.status is LlmStatus.UNCHECKED and store.load() == OFFLINE
    assert health.available


@pytest.mark.parametrize("key", ["", "   ", "kurz", "sk-ant-mit leerzeichen-" + "x" * 30])
async def test_obviously_wrong_input_is_refused_before_any_check(tmp_path: Path, key: str) -> None:
    keys, _, _, _, _ = service(tmp_path)
    with pytest.raises(AppError) as caught:
        await keys.save(key)
    assert caught.value.code is ErrorCode.VALIDATION_ERROR


async def test_delete_falls_back_to_the_environment_or_to_nothing(tmp_path: Path) -> None:
    keys, _, _, _, store = service(tmp_path, env=ENV)
    await keys.save(GOOD)
    state = await keys.delete()
    assert (state.source, state.suffix) == (KeySource.ENV, "Env7") and store.load() is None
    keys_without, health_without, llm, _, _ = service(tmp_path / "other")
    await keys_without.save(GOOD)
    await keys_without.delete()
    assert health_without.status is LlmStatus.MISSING_KEY and llm.current is None


async def test_a_stored_key_is_used_after_a_restart(tmp_path: Path) -> None:
    keys, _, _, _, _ = service(tmp_path, env=ENV)
    await keys.save(GOOD)
    again, _, _, built, _ = service(tmp_path, env=ENV)
    assert again.state().source is KeySource.SETTINGS and built.keys == [GOOD]


async def test_the_key_never_reaches_the_log(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    keys, _, _, _, _ = service(tmp_path)
    await keys.save(GOOD)
    with pytest.raises(AppError):
        await keys.save(BAD)
    await keys.delete()
    assert GOOD not in caplog.text and BAD not in caplog.text
    assert "Wx9Z" not in caplog.text


async def test_with_the_fake_model_the_key_is_managed_but_not_used(tmp_path: Path) -> None:
    store = FileSecretStore(tmp_path / "secrets" / "anthropic_api_key")
    health = LlmHealth(LlmStatus.OK)
    fake = FakeLLMClient()
    llm = SwappableLLM(fake)
    keys = ApiKeyService(store, FakeKeyValidator(), health, llm, Built(), env_key=None,
                         swaps_client=False)  # fmt: skip
    keys.load()
    assert keys.state().status is LlmStatus.MISSING_KEY
    assert (await keys.save(GOOD)).status is LlmStatus.OK
    assert llm.current is fake and health.status is LlmStatus.OK


async def test_the_replaced_client_is_closed(tmp_path: Path) -> None:
    keys, _, _, built, _ = service(tmp_path, env=ENV)
    await keys.save(GOOD)
    assert built.clients[0].closed and not built.clients[1].closed
    await keys.delete()
    assert built.clients[1].closed


async def test_save_and_delete_at_once_leave_file_and_memory_in_step(tmp_path: Path) -> None:
    """Without one lock, a delete could run while a save waits for the key check: the file
    gone, the key still in use (or the other way round)."""
    keys, _, llm, _, store = service(tmp_path)

    async def slow_check(key: str) -> KeyCheck:
        await asyncio.sleep(0.05)
        return KeyCheck.VALID

    keys._validator.check = slow_check  # type: ignore[method-assign]
    await asyncio.gather(keys.save(GOOD), keys.delete(), keys.save(OFFLINE))
    state = keys.state()
    assert (store.load() is not None) == (state.source is KeySource.SETTINGS)
    assert (store.load() is None) == (llm.current is None)
    if state.suffix is not None:
        assert store.load() is not None and store.load().endswith(state.suffix)
