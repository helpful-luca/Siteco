'use client';

import { useTranslations } from 'next-intl';

type Params = Record<string, string | number>;

/** Text for an error or notice code. Unknown codes fall back to a generic text, never to the code. */
export function useCodeText() {
  const errors = useTranslations('errors');
  const notices = useTranslations('notices');
  return {
    error: (code: string, params: Params = {}) =>
      errors.has(code) ? errors(code, params) : errors('UNKNOWN_ERROR'),
    notice: (code: string, params: Params = {}) => (notices.has(code) ? notices(code, params) : null),
  };
}
