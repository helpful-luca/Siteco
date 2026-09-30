'use client';

import { useCallback, useState } from 'react';
import { ApiError, toApiError } from '@/shared/api/errors';
import type { PreferencesBody } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { useSavePreferences } from '@/shared/preferences/preferences';

/** Saves a preference and keeps the refusal, so the group can say what went wrong. */
export function useSettingSave() {
  const savePreferences = useSavePreferences();
  const [error, setError] = useState<ApiError | null>(null);
  const save = useCallback(
    async (patch: Partial<PreferencesBody>): Promise<boolean> => {
      setError(null);
      try {
        await savePreferences(patch);
        return true;
      } catch (caught) {
        setError(toApiError(caught));
        return false;
      }
    },
    [savePreferences],
  );
  return { save, error };
}

export function SaveError({ error }: { error: ApiError | null }) {
  const text = useCodeText();
  if (!error) return null;
  return (
    <p role="alert" className="px-4 pt-2 text-footnote text-danger">
      {text.error(error.code, error.params)}
    </p>
  );
}
