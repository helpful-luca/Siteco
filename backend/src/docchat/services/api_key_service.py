"""The Claude key from Settings (feedback 1): stored on this machine, checked with a free call
before it is saved, used from the next question on. A key from Settings wins over
ANTHROPIC_API_KEY; deleting it falls back to the environment. The key is never logged and
never returned, only its last four characters."""

import asyncio
import logging
from collections.abc import Callable

from docchat.domain.api_key import KeyCheck, KeySource, KeyState, clean_key, key_suffix
from docchat.domain.enums import LlmStatus
from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import KeyValidator, LLMClient, SecretStore
from docchat.services.llm_health import LlmHealth
from docchat.services.swappable_llm import SwappableLLM

log = logging.getLogger("docchat.api_key")


class ApiKeyService:
    def __init__(
        self,
        store: SecretStore,
        validator: KeyValidator,
        health: LlmHealth,
        llm: SwappableLLM,
        build_client: Callable[[str], LLMClient],
        *,
        env_key: str | None,
        swaps_client: bool = True,
    ) -> None:
        self._store = store
        self._validator = validator
        self._health = health
        self._llm = llm
        self._build_client = build_client
        self._env_key = env_key
        # False with the fake model (tests, demo): the key is managed, the fake keeps answering.
        self._swaps_client = swaps_client
        self._source: KeySource | None = None
        self._key: str | None = None
        self._status = LlmStatus.MISSING_KEY  # of the key; with a fixed client not the health

    def load(self) -> None:
        """Startup: the stored key, else the environment's."""
        stored = self._store.load()
        if stored is not None:
            self._use(stored, KeySource.SETTINGS, LlmStatus.UNCHECKED)
        elif self._env_key is not None:
            self._use(self._env_key, KeySource.ENV, LlmStatus.UNCHECKED)
        else:
            self._use(None, None, LlmStatus.MISSING_KEY)

    def state(self) -> KeyState:
        return KeyState(
            configured=self._key is not None,
            source=self._source,
            suffix=key_suffix(self._key) if self._key is not None else None,
            # A key rejected during an answer shows up in the health (INVALID_KEY).
            status=self._health.status if self._swaps_client else self._status,
        )

    async def save(self, raw: str) -> KeyState:
        key = clean_key(raw)
        if key is None:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "This does not look like an API key.",
                details=[{"loc": ["body", "key"], "type": "value_error"}],
            )
        check = await self._validator.check(key)
        if check is KeyCheck.INVALID:
            log.info("api_key_rejected")
            raise AppError(ErrorCode.API_KEY_INVALID)
        await asyncio.to_thread(self._store.save, key)
        status = LlmStatus.OK if check is KeyCheck.VALID else LlmStatus.UNCHECKED
        self._use(key, KeySource.SETTINGS, status)
        log.info("api_key_saved", extra={"checked": check.value})
        return self.state()

    def delete(self) -> KeyState:
        """Removes the key from Settings; ANTHROPIC_API_KEY applies again if set."""
        self._store.delete()
        if self._env_key is not None:
            self._use(self._env_key, KeySource.ENV, LlmStatus.UNCHECKED)
        else:
            self._use(None, None, LlmStatus.MISSING_KEY)
        log.info("api_key_deleted")
        return self.state()

    def _use(self, key: str | None, source: KeySource | None, status: LlmStatus) -> None:
        self._key, self._source, self._status = key, source, status
        if not self._swaps_client:
            return
        self._llm.current = self._build_client(key) if key is not None else None
        self._health.status = status
