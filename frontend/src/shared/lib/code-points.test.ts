import { describe, expect, it } from 'vitest';
import { utf16Index } from './code-points';

describe('utf16Index', () => {
  it('is the identity for text without astral characters', () => {
    expect(utf16Index('Grüße', 3)).toBe(3);
  });

  it('counts an astral character as one code point but two UTF-16 units', () => {
    const text = 'a😀b';
    expect(utf16Index(text, 2)).toBe(3);
    expect(text.slice(utf16Index(text, 2))).toBe('b');
  });

  it('stops at the end of the text', () => {
    expect(utf16Index('ab', 10)).toBe(2);
  });
});
