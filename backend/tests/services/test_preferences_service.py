from dataclasses import replace
from pathlib import Path

import pytest

from docchat.adapters.sqlite.database import Database
from docchat.adapters.sqlite.preferences_store import SqlitePreferencesStore
from docchat.domain.enums import Locale
from docchat.domain.errors import AppError, ErrorCode
from docchat.services.preferences_service import PreferencesService
from tests.fakes import FakeClock

MODELS = ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5")


@pytest.fixture
def store(tmp_path: Path) -> SqlitePreferencesStore:
    database = Database(tmp_path / "app.db")
    database.migrate()
    return SqlitePreferencesStore(database)


@pytest.fixture
def service(store: SqlitePreferencesStore) -> PreferencesService:
    return PreferencesService(store, FakeClock(), MODELS, "claude-sonnet-5-5")


def test_defaults_until_something_is_saved(service: PreferencesService) -> None:
    prefs = service.get()
    assert not prefs.onboarded
    assert prefs.default_model == "claude-sonnet-5-5"


def test_saves_a_cleaned_name(service: PreferencesService) -> None:
    saved = service.update(replace(service.get(), name=" Luca\u202e ", onboarded=True))
    assert saved.name == "Luca"
    assert service.get() == saved


def test_rejects_a_model_that_is_not_offered(service: PreferencesService) -> None:
    with pytest.raises(AppError) as caught:
        service.update(replace(service.get(), default_model="gpt-5"))
    assert caught.value.code is ErrorCode.MODEL_NOT_ALLOWED
    with pytest.raises(AppError) as caught:
        service.update(replace(service.get(), compare_models=("claude-opus-5-5", "gpt-5")))
    assert caught.value.code is ErrorCode.MODEL_NOT_ALLOWED


def test_rejects_a_comparison_of_a_model_with_itself(service: PreferencesService) -> None:
    with pytest.raises(AppError) as caught:
        service.update(
            replace(service.get(), compare_models=("claude-opus-5-5", "claude-opus-5-5"))
        )
    assert caught.value.code is ErrorCode.VALIDATION_ERROR


def test_a_model_switched_off_later_falls_back_to_the_default(
    store: SqlitePreferencesStore,
) -> None:
    before = PreferencesService(store, FakeClock(), MODELS, "claude-sonnet-5-5")
    before.update(replace(before.get(), default_model="claude-opus-5-5", locale=Locale.EN))
    after = PreferencesService(
        store, FakeClock(), ("claude-haiku-4-5", "claude-sonnet-5-5"), "claude-sonnet-5-5"
    )
    prefs = after.get()
    assert prefs.default_model == "claude-sonnet-5-5"
    assert prefs.compare_models == ("claude-sonnet-5-5", "claude-haiku-4-5")
    assert prefs.locale is Locale.EN


def test_reset_brings_back_the_setup(service: PreferencesService) -> None:
    service.update(replace(service.get(), onboarded=True))
    service.reset()
    assert not service.get().onboarded
