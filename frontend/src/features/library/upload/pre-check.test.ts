import { describe, expect, it } from 'vitest';
import { extensionOf, preCheck } from './pre-check';

const MB = 1024 * 1024;

describe('preCheck', () => {
  it('accepts PDF, text and Markdown in any case', () => {
    for (const name of ['a.pdf', 'b.TXT', 'c.md', 'd.Markdown']) {
      expect(preCheck({ name, size: 10 }, 1024)).toBeNull();
    }
  });

  it('rejects other types, empty and too large files', () => {
    expect(preCheck({ name: 'a.docx', size: 10 }, 1024)?.code).toBe('UNSUPPORTED_TYPE');
    expect(preCheck({ name: 'README', size: 10 }, 1024)?.code).toBe('UNSUPPORTED_TYPE');
    expect(preCheck({ name: 'a.pdf', size: 0 }, 1024)?.code).toBe('EMPTY_FILE');
    expect(preCheck({ name: 'a.pdf', size: 2 * MB + 1 }, 2)).toEqual({
      code: 'UPLOAD_TOO_LARGE',
      params: { max_mb: 2 },
      retryable: false,
    });
  });

  it('leaves the size to the backend while the limits are unknown', () => {
    expect(preCheck({ name: 'a.pdf', size: 10 * 1024 * MB }, undefined)).toBeNull();
  });

  it('reads the extension after the last dot', () => {
    expect(extensionOf('Katalog.2026.PDF')).toBe('.pdf');
    expect(extensionOf('noext')).toBe('');
  });
});
