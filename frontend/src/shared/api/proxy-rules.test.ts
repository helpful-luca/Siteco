import { describe, expect, it } from 'vitest';
import { checkMutationGuard, exceedsBodyLimit, isSafePath, pickHeaders } from '@/shared/api/proxy-rules';

describe('isSafePath', () => {
  it('accepts normal segments', () => expect(isSafePath(['chats', 'c_12', 'messages'])).toBe(true));
  it.each([[['..', 'x']], [['a%2Fb']], [['.']], [['a b']], [[]], [['health', '']], [['a/b']]])(
    'rejects %j',
    (segments) => expect(isSafePath(segments)).toBe(false),
  );
});

describe('checkMutationGuard', () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  const host = 'localhost:3000';

  it('allows GET without extra headers', () =>
    expect(checkMutationGuard('GET', headers({}), host)).toBe('ok'));
  it('rejects POST without X-Requested-With', () =>
    expect(checkMutationGuard('POST', headers({ origin: 'http://localhost:3000' }), host)).toBe(
      'FORBIDDEN_ORIGIN',
    ));
  it('rejects POST from a foreign origin', () =>
    expect(
      checkMutationGuard(
        'POST',
        headers({ origin: 'https://evil.example', 'x-requested-with': 'docchat' }),
        host,
      ),
    ).toBe('FORBIDDEN_ORIGIN'));
  it('rejects a malformed origin', () =>
    expect(
      checkMutationGuard('POST', headers({ origin: 'null', 'x-requested-with': 'docchat' }), host),
    ).toBe('FORBIDDEN_ORIGIN'));
  it('allows POST from the same origin with the header', () =>
    expect(
      checkMutationGuard(
        'POST',
        headers({ origin: 'http://localhost:3000', 'x-requested-with': 'docchat' }),
        host,
      ),
    ).toBe('ok'));
  it('allows DELETE without Origin but with the header', () =>
    expect(checkMutationGuard('DELETE', headers({ 'x-requested-with': 'docchat' }), host)).toBe('ok'));
});

describe('pickHeaders', () => {
  it('keeps only allowlisted headers', () => {
    const out = pickHeaders(
      new Headers({ cookie: 'a=b', 'content-type': 'application/json' }),
      ['content-type'],
    );
    expect(out.get('cookie')).toBeNull();
    expect(out.get('content-type')).toBe('application/json');
  });
});

describe('exceedsBodyLimit', () => {
  it('refuses JSON bodies over 64 KB before they reach the backend', () => {
    expect(exceedsBodyLimit('POST', ['chats'], String(64 * 1024 + 1))).toBe(true);
    expect(exceedsBodyLimit('PATCH', ['chats', 'c1'], '70000')).toBe(true);
  });

  it('lets small bodies, reads and the raw upload through', () => {
    expect(exceedsBodyLimit('POST', ['chats'], '512')).toBe(false);
    expect(exceedsBodyLimit('POST', ['chats'], null)).toBe(false);
    expect(exceedsBodyLimit('GET', ['documents'], '999999')).toBe(false);
    expect(exceedsBodyLimit('POST', ['documents'], String(500 * 1024 * 1024))).toBe(false);
  });
});
