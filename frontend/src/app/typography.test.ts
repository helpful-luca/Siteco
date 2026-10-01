import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('line breaks', () => {
  it('balances headings and short centred text', () => {
    expect(css).toMatch(/:where\(h1, h2, h3[^)]*\.text-center, \.text-footnote, \.text-caption\)\s*\{\s*text-wrap: balance;/);
    expect(css).toMatch(/:where\(\.text-center\) :where\(p, span\)\s*\{\s*text-wrap: balance;/);
  });

  it('keeps all text free of widows, inherited from <body> by every element', () => {
    expect(css).toMatch(/\n  body \{\n    text-wrap: pretty;\n  \}/);
  });
});
