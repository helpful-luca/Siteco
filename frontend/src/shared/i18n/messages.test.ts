import { describe, expect, it } from 'vitest';
import de from '../../../messages/de.json';
import en from '../../../messages/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

const german = flatten(de as Tree);
const english = flatten(en as Tree);

describe('message catalogs', () => {
  it('have identical keys in German and English', () => {
    expect(Object.keys(german).sort()).toEqual(Object.keys(english).sort());
  });

  it('contain no em or en dashes', () => {
    for (const text of [...Object.values(german), ...Object.values(english)]) {
      expect(text).not.toMatch(/[–—]/);
    }
  });

  it('address the user with du in German, never Sie', () => {
    for (const text of Object.values(german)) {
      expect(text).not.toMatch(/\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/);
    }
  });

  it('never blames or apologizes in German: no "ungültig", no "leider" (annex 10, 2.2)', () => {
    for (const text of Object.values(german)) {
      expect(text).not.toMatch(/ungültig|leider/i);
    }
  });

  it('gives every error a next step: what happened, then what to do', () => {
    // A single sentence is fine only when it is the instruction itself.
    const oneStep = new Set(['errors.QUESTION_EMPTY', 'errors.DUPLICATE_REQUEST']);
    const errors = Object.entries(german).filter(([key]) => /^errors\.[A-Z_]+$/.test(key));
    for (const [key, text] of errors) {
      if (oneStep.has(key)) continue;
      expect(text.split(/[.!?](\s|$)/).filter((part) => part && part.trim()).length, key).toBeGreaterThanOrEqual(2);
    }
  });
});

