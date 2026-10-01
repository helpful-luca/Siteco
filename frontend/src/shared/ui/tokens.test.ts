import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/shared/ui/contrast';

// Vitest runs from the frontend root.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Reads `--c-*: #hex;` declarations from the first block that starts with `selector {`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing block ${selector}`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--c-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
  );
}

const PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ['ink', 'canvas', 7],
  ['ink', 'surface', 7],
  ['ink-muted', 'surface', 4.5],
  ['ink-muted', 'canvas', 4.5],
  ['accent-ink', 'surface', 4.5],
  ['accent-ink', 'canvas', 4.5],
  ['on-accent', 'accent', 4.5],
  ['danger', 'surface', 4.5],
  ['danger', 'canvas', 4.5],
  ['accent', 'surface', 3],
  ['on-accent', 'accent', 4.5],
  ['success', 'surface', 4.5],
];

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('%s theme contrast', (_, selector) => {
  const t = tokens(selector);
  it.each(PAIRS)('%s on %s is at least %d:1', (fg, bg, min) => {
    expect(t[fg], `token ${fg}`).toBeDefined();
    expect(t[bg], `token ${bg}`).toBeDefined();
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5));
  it('is symmetric', () =>
    expect(contrastRatio('#b61918', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#b61918'), 10));
});
