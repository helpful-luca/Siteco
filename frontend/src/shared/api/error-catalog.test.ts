/**
 * `docs/errors.md` is generated from the contract (status and retryable per code, exported from
 * `domain/errors.py`), the surfaces in error-catalog.ts and the German texts. This test fails
 * when the file is out of date; `UPDATE_ERRORS_DOC=1 npx vitest run error-catalog` rewrites it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import contract from '../../../../contracts/openapi.json';
import de from '../../../messages/de.json';
import { CLIENT_ERROR_SPECS, ERROR_SURFACES, type ErrorSurface } from './error-catalog';
import { CLIENT_ERROR_CODES } from './errors';

type Spec = { status: number; retryable: boolean };
type Contract = { components: { schemas: { ErrorCode: { enum: string[]; 'x-error-specs': Record<string, Spec> } } } };

// Tests run from frontend/ (npm test, vitest).
const DOC = resolve(process.cwd(), '../docs/errors.md');
const backend = (contract as unknown as Contract).components.schemas.ErrorCode;

const WHERE: Record<ErrorSurface, string> = {
  composer: 'composer note',
  countdown: 'countdown (composer, upload row)',
  answer: 'inline in the answer',
  library: 'library row',
  viewer: 'source panel',
  banner: 'global banner',
  startup: 'startup screen',
  page: 'whole view',
  form: 'next to the control',
  silent: 'nothing (ignored)',
};

/** Example values, so the table shows sentences instead of placeholders. */
const SAMPLE = {
  seconds: 23,
  max: 3,
  max_mb: 1024,
  max_kb: 64,
  model: 'Claude Sonnet 5.5',
  fallback: 'Claude Haiku 4.5',
  time: '02:00',
  status: 502,
};

/** Where one sample does not fit every code. */
const SAMPLE_FOR: Record<string, Partial<typeof SAMPLE>> = {
  CHAT_LIMIT: { max: 100 },
  MESSAGE_LIMIT: { max: 200 },
  QUESTION_TOO_LONG: { max: 4000 },
};

const t = createTranslator({ locale: 'de', messages: de, namespace: 'errors' });

function row(code: string, status: string, retryable: boolean, origin: string): string {
  const where = ERROR_SURFACES[code as keyof typeof ERROR_SURFACES].map((s) => WHERE[s]).join(', ');
  const text = t(code as Parameters<typeof t>[0], { ...SAMPLE, ...SAMPLE_FOR[code] }).replaceAll('|', '\\|');
  return `| \`${code}\` | ${status} | ${retryable ? 'yes' : 'no'} | ${origin} | ${where} | ${text} |`;
}

function render(): string {
  const specs = backend['x-error-specs'];
  const lines = [
    '# Error codes',
    '',
    'Generated from `contracts/openapi.json` (status and retryable, exported from',
    '`backend/src/docchat/domain/errors.py`), `frontend/src/shared/api/error-catalog.ts` (where a',
    'code appears) and `frontend/messages/de.json` (the text, with example values). Do not edit by',
    'hand: `cd frontend && UPDATE_ERRORS_DOC=1 npx vitest run error-catalog` rewrites it, and the',
    'same test fails when it is out of date.',
    '',
    'Every error travels as one envelope `{error: {code, message, retryable, retry_after, request_id,',
    'params, details}}`. The UI never shows `message`; it shows the text of `code`. HTTP is the',
    'status before a stream opens; inside an answer stream the same codes arrive as an `error` event',
    '(HTTP 200). Our own limit is `RATE_LIMITED` (429 with `Retry-After`); Claude being busy is',
    '`LLM_RATE_LIMITED` or `LLM_OVERLOADED`, sent as 503, never as 429. Ingestion failures are no',
    'HTTP errors: the document ends `failed` with the code.',
    '',
    '| Code | HTTP | Retry | From | Where it appears | What you see (DE) |',
    '|---|---|---|---|---|---|',
    ...backend.enum.map((code) => row(code, String(specs[code].status), specs[code].retryable, 'backend')),
    ...CLIENT_ERROR_CODES.map((code) => {
      const spec = CLIENT_ERROR_SPECS[code];
      return row(code, spec.status === null ? 'none' : String(spec.status), spec.retryable, spec.origin);
    }),
    '',
  ];
  return lines.join('\n');
}

describe('error catalog', () => {
  it('places every code of the contract and nothing else', () => {
    expect(Object.keys(ERROR_SURFACES).sort()).toEqual([...backend.enum, ...CLIENT_ERROR_CODES].sort());
    expect(Object.keys(backend['x-error-specs']).sort()).toEqual([...backend.enum].sort());
  });

  it('docs/errors.md is up to date', () => {
    const expected = render();
    if (process.env.UPDATE_ERRORS_DOC === '1') writeFileSync(DOC, expected);
    expect(readFileSync(DOC, 'utf8')).toBe(expected);
  });
});
