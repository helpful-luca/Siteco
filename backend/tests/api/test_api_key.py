"""The Claude key in Settings: never returned, stored 0600 outside the database and exports,
used without a restart, removed with the settings."""

import io
import stat
import zipfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from docchat.core.config import Settings
from docchat.domain.api_key import KeyCheck
from tests.fakes import FakeKeyValidator
from tests.support import make_app

GOOD = "sk-ant-api03-" + "g" * 60 + "Ok42"
BAD = "sk-ant-api03-" + "b" * 60 + "No00"


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    validator = FakeKeyValidator({BAD: KeyCheck.INVALID})
    with TestClient(make_app(settings, key_validator=validator)) as c:
        yield c


def test_without_a_key_the_app_is_retrieval_only(client: TestClient) -> None:
    body = client.get("/api/settings/api-key").json()
    assert body == {"configured": False, "source": None, "suffix": None, "status": "missing_key"}
    assert client.get("/api/config").json()["features"]["retrieval_only"] is True


def test_a_saved_key_applies_without_a_restart_and_is_never_returned(
    client: TestClient, settings: Settings
) -> None:
    r = client.put("/api/settings/api-key", json={"key": GOOD})
    assert r.status_code == 200, r.text
    assert r.json() == {"configured": True, "source": "settings", "suffix": "Ok42", "status": "ok"}
    assert GOOD not in r.text
    assert GOOD not in client.get("/api/settings/api-key").text
    config = client.get("/api/config").json()
    assert (config["llm_status"], config["features"]["retrieval_only"]) == ("ok", False)
    path = settings.data_dir / "secrets" / "anthropic_api_key"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert path.read_text() == GOOD


def test_a_refused_key_is_reported_and_not_stored(client: TestClient, settings: Settings) -> None:
    r = client.put("/api/settings/api-key", json={"key": BAD})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "API_KEY_INVALID")
    assert BAD not in r.text
    assert not (settings.data_dir / "secrets" / "anthropic_api_key").exists()


def test_the_key_is_not_in_the_database_or_the_export(
    client: TestClient, settings: Settings
) -> None:
    client.put("/api/settings/api-key", json={"key": GOOD})
    assert GOOD.encode() not in settings.database_path.read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(client.get("/api/workspace/export").content))
    for name in archive.namelist():
        assert GOOD.encode() not in archive.read(name)


def test_delete_all_data_keeps_the_key_unless_settings_are_reset(client: TestClient) -> None:
    client.put("/api/settings/api-key", json={"key": GOOD})
    assert client.delete("/api/workspace").status_code == 204
    assert client.get("/api/settings/api-key").json()["configured"] is True
    assert client.delete("/api/workspace?reset_preferences=true").status_code == 204
    assert client.get("/api/settings/api-key").json()["configured"] is False


def test_delete_the_key(client: TestClient, settings: Settings) -> None:
    client.put("/api/settings/api-key", json={"key": GOOD})
    r = client.delete("/api/settings/api-key")
    assert r.json()["configured"] is False
    assert not (settings.data_dir / "secrets" / "anthropic_api_key").exists()


def test_the_month_spend_comes_from_the_usage_ledger(client: TestClient) -> None:
    container = client.app.state.container  # type: ignore[attr-defined]
    today = container.budget._clock.now().date()
    container.budget._ledger.record(today.isoformat(), 0.5, 10, 10)
    container.budget._ledger.record(today.replace(day=1).isoformat(), 0.25, 10, 10)
    body = client.get("/api/workspace").json()
    assert body["usage_today"]["cost_usd"] == pytest.approx(0.5 if today.day > 1 else 0.75)
    assert body["usage_month"] == {"cost_usd": pytest.approx(0.75), "requests": 2}
