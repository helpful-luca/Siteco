import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@/shared/api/types';
import { codeParams } from './code-params';

const models = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
] as ModelInfo[];

describe('codeParams', () => {
  it('shows model labels instead of ids', () => {
    const params = codeParams(
      { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-4-5', other: 'claude-sonnet-5-5' },
      { models, locale: 'de' },
    );
    expect(params).toMatchObject({ model: 'Claude Sonnet 5.5', fallback: 'Claude Haiku 4.5', other: 'claude-sonnet-5-5' });
  });

  it('keeps unknown model ids as they are', () => {
    expect(codeParams({ model: 'claude-x' }, { models, locale: 'en' }).model).toBe('claude-x');
  });

  it('turns the reset time into a local clock time', () => {
    const reset = new Date(2026, 9, 1, 2, 0);
    const params = codeParams({ reset_time: reset.toISOString() }, { locale: 'de' });
    expect(params.time).toBe('02:00');
  });

  it('fills seconds from retry_after so countdown texts always have a number', () => {
    expect(codeParams({}, { locale: 'de', retryAfter: 23 }).seconds).toBe(23);
    expect(codeParams({ seconds: 5 }, { locale: 'de', retryAfter: 23 }).seconds).toBe(5);
    expect(codeParams(null, { locale: 'de' }).seconds).toBe(0);
  });

  it('never passes objects on to the formatter', () => {
    expect(codeParams({ list: [1, 2], none: null }, { locale: 'de' })).toMatchObject({ list: '1,2' });
  });
});
