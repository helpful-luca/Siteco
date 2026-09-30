'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useConfig } from '@/shared/api/use-config';
import { codeParams } from './code-params';

type RawParams = Record<string, unknown> | null | undefined;

/**
 * Text for an error or notice code. Unknown codes fall back to a generic text, never to the code.
 * Params are prepared once here (model labels, local reset time, seconds), for every caller.
 */
export function useCodeText() {
  const errors = useTranslations('errors');
  const notices = useTranslations('notices');
  const locale = useLocale();
  const { data: config } = useConfig();
  const prepare = (params: RawParams, retryAfter?: number | null) =>
    codeParams(params, { models: config?.models, locale, retryAfter });
  return {
    error: (code: string, params?: RawParams, retryAfter?: number | null) =>
      errors.has(code) ? errors(code, prepare(params, retryAfter)) : errors('UNKNOWN_ERROR'),
    notice: (code: string, params?: RawParams) =>
      notices.has(code) ? notices(code, prepare(params)) : null,
  };
}
