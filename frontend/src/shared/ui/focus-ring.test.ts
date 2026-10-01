import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Tailwind 4: `outline-none` and `outline-hidden` set --tw-outline-style to none, and
 * `focus-visible:outline-2` reads that variable, so the pair draws no focus ring at all. Elements
 * with their own focus outline leave the resting outline alone (the base rule only draws it on
 * :focus-visible anyway).
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

describe('focus rings', () => {
  it('never pairs outline-none or outline-hidden with a focus outline in one class list', () => {
    const offenders: string[] = [];
    for (const path of files(join(process.cwd(), 'src'))) {
      const text = readFileSync(path, 'utf8');
      // One class list: a string literal, or the lines of one cn(...) call.
      for (const chunk of text.split(/className=|cn\(/)) {
        const list = chunk.slice(0, 600).split(/\)\s*}|"\s*>|"\s*\/>/)[0] ?? '';
        if (/\boutline-(none|hidden)\b/.test(list) && /(focus-visible|focus):outline-(?!none|hidden)/.test(list)) {
          offenders.push(relative(process.cwd(), path));
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
