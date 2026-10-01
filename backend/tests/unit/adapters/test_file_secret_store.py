import stat
from pathlib import Path

from docchat.adapters.file_secret_store import FileSecretStore


def test_the_key_is_readable_by_the_owner_only(tmp_path: Path) -> None:
    store = FileSecretStore(tmp_path / "secrets" / "anthropic_api_key")
    assert store.load() is None
    store.save("sk-ant-api03-secret")
    path = tmp_path / "secrets" / "anthropic_api_key"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    assert store.load() == "sk-ant-api03-secret"
    store.save("sk-ant-api03-other")
    assert store.load() == "sk-ant-api03-other"
    assert [p.name for p in path.parent.iterdir()] == ["anthropic_api_key"]  # no temp left


def test_delete_removes_the_file_and_is_idempotent(tmp_path: Path) -> None:
    store = FileSecretStore(tmp_path / "secrets" / "anthropic_api_key")
    store.save("sk-ant-api03-secret")
    store.delete()
    store.delete()
    assert store.load() is None
    assert not (tmp_path / "secrets" / "anthropic_api_key").exists()


def test_an_empty_file_is_no_key(tmp_path: Path) -> None:
    path = tmp_path / "anthropic_api_key"
    path.write_text("  \n")
    assert FileSecretStore(path).load() is None
