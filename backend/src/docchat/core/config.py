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

    # Models and answers (annex 11, 4). No sampling parameters on purpose.
    default_model: str = "claude-sonnet-5-5"
    enabled_models: list[str] = ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5"]
    sonnet_thinking: Literal["adaptive", "between_tools"] = "adaptive"
    max_output_tokens: int = 4096
    llm_ttft_timeout_s: float = 60
    llm_total_timeout_s: float = 180
    llm_max_retries: int = 2
    llm_concurrency: int = 4

    # Retrieval and conversation (eval switches)
    retrieval_candidates: int = 20
    top_k: int = 8
    per_document_cap: int = 5
    full_context_max_tokens: int = 20_000
    history_max_turns: int = 6
    history_max_tokens: int = 6000

    # Chat limits (master spec 9). No daily budget unless DAILY_BUDGET_USD is set.
    max_question_chars: int = 4000
    max_chats: int = 100
    max_messages_per_chat: int = 200
    max_concurrent_streams: int = 3
    daily_budget_usd: float | None = None

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
    # OCR for pages without a text layer (master spec 6.8). `off` or a missing binary: such pages
    # stay unsearchable and get the PAGES_WITHOUT_TEXT notice.
    ocr: Literal["on", "off"] = "on"
    ocr_languages: str = "deu+eng"
    ocr_page_timeout_s: int = 60
    embed_batch_size: int = 32
    index_write_batch: int = 256

    # Malware scan (master spec 6.9). `off` is for development only; the UI then shows a hint.
    malware_scan: Literal["required", "off"] = "required"
    clamd_host: str = "clamav"
    clamd_port: int = 3310
    clamd_scan_timeout_s: int = 900  # above clamd's MaxScanTime (600 s)
    # Must match StreamMaxLength of the clamav service in compose.yaml.
    clamd_stream_max_mb: int = 1100

    internal_token: SecretStr | None = None
    app_version: str = "dev"
    git_sha: str = "unknown"
    log_level: str = "INFO"

    @field_validator("anthropic_api_key", "internal_token", "daily_budget_usd", mode="before")
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

    @property
    def quarantine_dir(self) -> Path:
        return self.data_dir / "quarantine"


@lru_cache
def get_settings() -> Settings:
    return Settings()
