"""Preferences: read with defaults, validate, save. The backend is the truth for every window
(browser and desktop); the UI mirrors the render-critical values as cookies (annex 11, 5.1)."""

import logging
from collections.abc import Sequence
from dataclasses import replace

from docchat.domain.errors import AppError, ErrorCode
from docchat.domain.ports import Clock, PreferencesStore
from docchat.domain.preferences import Preferences, clean_name, default_preferences

log = logging.getLogger("docchat.preferences")


class PreferencesService:
    def __init__(
        self,
        store: PreferencesStore,
        clock: Clock,
        enabled_models: Sequence[str],
        default_model: str,
    ) -> None:
        self._store = store
        self._clock = clock
        self._models = tuple(enabled_models)
        self._defaults = default_preferences(default_model)

    def get(self) -> Preferences:
        """Stored values, with models that are no longer offered replaced by the defaults."""
        stored = self._store.load()
        if stored is None:
            return self._defaults
        prefs = stored
        if prefs.default_model not in self._models:
            prefs = replace(prefs, default_model=self._defaults.default_model)
        if any(m not in self._models for m in prefs.compare_models):
            prefs = replace(prefs, compare_models=self._defaults.compare_models)
        return prefs

    def _check_model(self, model: str) -> None:
        if model not in self._models:
            raise AppError(ErrorCode.MODEL_NOT_ALLOWED, params={"model": model})

    def update(self, preferences: Preferences) -> Preferences:
        self._check_model(preferences.default_model)
        for model in preferences.compare_models:
            self._check_model(model)
        if preferences.compare_models[0] == preferences.compare_models[1]:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "The comparison needs two different models.",
                details=[{"loc": ["body", "compare_models"], "type": "value_error"}],
            )
        cleaned = replace(preferences, name=clean_name(preferences.name))
        self._store.save(cleaned, self._clock.now())
        log.info("preferences_saved")  # never the values: the name is personal data
        return cleaned

    def reset(self) -> None:
        self._store.clear()
        log.info("preferences_reset")
