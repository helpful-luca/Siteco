"""The Claude key entered in Settings, checked with a free call before it is saved.

A key from Settings wins over ANTHROPIC_API_KEY; deleting it falls back to the environment. The
key is never logged or returned, only its last four characters. A default-workspace key also
needs a workspace id, saved next to it or taken from ANTHROPIC_WORKSPACE_ID.
"""

import asyncio
import logging
from collections.abc import Callable

from docchat.domain.api_key import (
    KeyCheck,
    KeySource,
    KeyState,
    clean_key,
    clean_workspace_id,
    key_suffix,
)
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
        build_client: Callable[[str, str | None], LLMClient],
        *,
        env_key: str | None,
        workspace_store: SecretStore | None = None,
        env_workspace_id: str | None = None,
        swaps_client: bool = True,
    ) -> None:
        self._store = store
        self._workspace_store = workspace_store
        self._env_workspace_id = env_workspace_id
        self._validator = validator
        self._health = health
        self._llm = llm
        self._build_client = build_client
        self._env_key = env_key
        # False with the fake model (tests, demo): the key is managed, the fake keeps answering.
        self._swaps_client = swaps_client
        self._source: KeySource | None = None
        self._key: str | None = None
        self._workspace_id: str | None = None
        self._status = LlmStatus.MISSING_KEY  # of the key; with a fixed client not the health
        # Save and delete one at a time: the file, the key in memory and the client stay in step.
        self._lock = asyncio.Lock()

    def load(self) -> None:
        """Startup (before anything runs): the stored key, else the environment's."""
        self._workspace_id = self._stored_workspace_id() or self._env_workspace_id
        stored = self._store.load()
        if stored is not None:
            self._set(stored, KeySource.SETTINGS, LlmStatus.UNCHECKED)
        elif self._env_key is not None:
            self._set(self._env_key, KeySource.ENV, LlmStatus.UNCHECKED)
        else:
            self._set(None, None, LlmStatus.MISSING_KEY)
        if self._swaps_client:
            self._llm.current = self._client(self._key)

    def state(self) -> KeyState:
        return KeyState(
            configured=self._key is not None,
            source=self._source,
            suffix=key_suffix(self._key) if self._key is not None else None,
            # A key rejected during an answer shows up in the health (INVALID_KEY).
            status=self._health.status if self._swaps_client else self._status,
            workspace_id=self._workspace_id,
        )

    async def save(self, raw: str, raw_workspace_id: str | None = None) -> KeyState:
        """Key and workspace id together: an empty workspace id removes the stored one (the
        environment's applies again)."""
        key = clean_key(raw)
        if key is None:
            raise _invalid("key", "This does not look like an API key.")
        try:
            workspace_id = clean_workspace_id(raw_workspace_id)
        except ValueError:
            raise _invalid("workspace_id", "This does not look like a workspace id.") from None
        effective = workspace_id or self._env_workspace_id
        async with self._lock:
            check = await self._validator.check(key, effective)
            if check is KeyCheck.INVALID:
                log.info("api_key_rejected")
                raise AppError(ErrorCode.API_KEY_INVALID)
            if check is KeyCheck.NEEDS_WORKSPACE:
                log.info("api_key_needs_workspace", extra={"workspace_id_set": bool(effective)})
                raise AppError(ErrorCode.LLM_KEY_NEEDS_WORKSPACE)
            await asyncio.to_thread(self._store.save, key)
            await asyncio.to_thread(self._save_workspace_id, workspace_id)
            self._workspace_id = effective
            status = LlmStatus.OK if check is KeyCheck.VALID else LlmStatus.UNCHECKED
            await self._use(key, KeySource.SETTINGS, status)
            log.info("api_key_saved", extra={"checked": check.value})
            return self.state()

    async def delete(self) -> KeyState:
        """Removes key and workspace id from Settings; the environment's apply again if set."""
        async with self._lock:
            await asyncio.to_thread(self._store.delete)
            await asyncio.to_thread(self._save_workspace_id, None)
            self._workspace_id = self._env_workspace_id
            if self._env_key is not None:
                await self._use(self._env_key, KeySource.ENV, LlmStatus.UNCHECKED)
            else:
                await self._use(None, None, LlmStatus.MISSING_KEY)
            log.info("api_key_deleted")
            return self.state()

    def _stored_workspace_id(self) -> str | None:
        if self._workspace_store is None:
            return None
        try:
            return clean_workspace_id(self._workspace_store.load())
        except ValueError:
            log.warning("workspace_id_ignored")  # edited by hand into something unusable
            return None

    def _save_workspace_id(self, workspace_id: str | None) -> None:
        if self._workspace_store is None:
            return
        if workspace_id is None:
            self._workspace_store.delete()
        else:
            self._workspace_store.save(workspace_id)

    def _client(self, key: str | None) -> LLMClient | None:
        return self._build_client(key, self._workspace_id) if key is not None else None

    def _set(self, key: str | None, source: KeySource | None, status: LlmStatus) -> None:
        self._key, self._source, self._status = key, source, status
        if self._swaps_client:
            self._health.status = status

    async def _use(self, key: str | None, source: KeySource | None, status: LlmStatus) -> None:
        """Only on the event loop, under the lock: the key, its client and the health."""
        self._set(key, source, status)
        if self._swaps_client:
            await self._llm.swap(self._client(key))


def _invalid(field: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        details=[{"loc": ["body", field], "type": "value_error"}],
    )
