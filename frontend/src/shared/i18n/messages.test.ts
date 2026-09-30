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
});
