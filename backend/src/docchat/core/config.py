"""All environment configuration lives here and nowhere else."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: SecretStr | None = None
    llm_provider: Literal["anthropic", "fake"] = "anthropic"

    data_dir: Path = Path("/data")
    embedding_model: str = "ibm-granite/granite-embedding-97m-multilingual-r2"
    embedding_cache_dir: Path = Path("/opt/models")
    embedding_local_only: bool = True
    # Threads for embedding during ingestion. Default: half the cores, so chat stays responsive.
    embedding_threads: int | None = None
    fts_language: str = "German"

    # Library limits (master spec 6.8). All sizes in MB.
    max_upload_mb: int = 1024
    max_pdf_pages: int = 5000
    max_chars_per_doc: int = 50_000_000
    max_storage_mb: int = 20 * 1024
    min_free_disk_mb: int = 512

    # Ingestion pipeline
    parse_batch_pages: int = 50
    parse_timeout_s: int = 60
    parse_max_failed_batches: int = 3
    embed_batch_size: int = 32
    index_write_batch: int = 256

    internal_token: SecretStr | None = None
    app_version: str = "dev"
    git_sha: str = "unknown"
    log_level: str = "INFO"

    @field_validator("anthropic_api_key", "internal_token", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def llm_key_configured(self) -> bool:
        return self.anthropic_api_key is not None

    @property
    def database_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def lancedb_dir(self) -> Path:
        return self.data_dir / "lancedb"

    @property
    def spool_dir(self) -> Path:
        return self.data_dir / "spool"


@lru_cache
def get_settings() -> Settings:
    return Settings()
