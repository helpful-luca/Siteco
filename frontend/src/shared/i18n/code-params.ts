import type { ModelInfo } from '@/shared/api/types';

export type TextParams = Record<string, string | number>;

const MODEL_KEYS = new Set(['model', 'fallback', 'old', 'new']);

/**
 * Turns the raw `params` of an error or notice into what the texts expect: model ids become
 * their labels, `reset_time` becomes a local clock time (`time`), and `seconds` falls back to
 * `retry_after`, so a countdown text never shows a placeholder.
 */
export function codeParams(
  raw: Record<string, unknown> | null | undefined,
  { models, locale, retryAfter }: { models?: ModelInfo[]; locale: string; retryAfter?: number | null },
): TextParams {
  const out: TextParams = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value === 'number') out[key] = value;
    else if (typeof value === 'string')
      out[key] = MODEL_KEYS.has(key) ? (models?.find((m) => m.id === value)?.label ?? value) : value;
    else if (value !== null && value !== undefined) out[key] = String(value);
  }
  if (typeof out.reset_time === 'string') {
    const reset = new Date(out.reset_time);
    if (!Number.isNaN(reset.getTime())) {
      out.time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(reset);
    }
  }
  out.time ??= '';
  out.seconds ??= retryAfter ?? 0;
  return out;
}
