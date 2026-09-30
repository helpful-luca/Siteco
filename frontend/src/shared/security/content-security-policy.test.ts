import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './content-security-policy';

const directives = new Map(
  CONTENT_SECURITY_POLICY.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values] as const;
  }),
);

describe('content security policy', () => {
  it('lets the PDF.js worker run from our origin', () => {
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
  });

  it('never allows JavaScript eval or foreign origins', () => {
    for (const values of directives.values()) {
      expect(values).not.toContain("'unsafe-eval'");
      expect(values.every((value) => !value.startsWith('http'))).toBe(true);
    }
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });
});
