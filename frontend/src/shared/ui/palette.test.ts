import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The palette is graphite plus Siteco red. The old sodium amber and any other orange must not come
 * back: not as a token, not hardcoded in a component, an SVG or the desktop splash. The highlight
 * yellow (cited passages) and the flags sit above this band and stay allowed.
 */

// Vitest runs from the frontend root.
const ROOTS = ['src', 'public', '../desktop/src', '../desktop/static', '../desktop/assets'];
const EXTENSIONS = new Set(['.css', '.ts', '.tsx', '.svg', '.html', '.js', '.mjs']);
const IGNORED = new Set(['node_modules', 'schema.gen.ts', 'pdfjs']);

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.has(extname(name)) && !name.includes('.test.') ? [path] : [];
  });
}

type Rgb = [number, number, number];

function parse(literal: string): Rgb | null {
  const hex = literal.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = literal.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? ([+rgb[1], +rgb[2], +rgb[3]] as Rgb) : null;
}

/** Hue in degrees and HSL saturation (0 to 1). */
export function hueAndSaturation([r, g, b]: Rgb): { hue: number; saturation: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  hue *= 60;
  return { hue: hue < 0 ? hue + 360 : hue, saturation };
}

/** Orange and amber: between the reds (below 15 degrees) and the yellows (from 46 degrees). */
function isAmber(rgb: Rgb): boolean {
  const { hue, saturation } = hueAndSaturation(rgb);
  return saturation > 0.35 && hue >= 15 && hue < 46;
}

const COLOR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi;
const OLD_CLASSES = /\b(sodium|amber-\d|orange-\d)/;

describe('palette', () => {
  it('flags the old sodium amber and accepts red, yellow and grey', () => {
    expect(isAmber(parse('#f0a030')!)).toBe(true);
    expect(isAmber(parse('#ffb547')!)).toBe(true);
    expect(isAmber(parse('#a84a08')!)).toBe(true);
    expect(isAmber(parse('rgb(255 196 110 / 0.34)')!)).toBe(true);
    expect(isAmber(parse('#b61918')!)).toBe(false);
    expect(isAmber(parse('#ffd60a')!)).toBe(false);
    expect(isAmber(parse('#6e6e73')!)).toBe(false);
  });

  const sources = ROOTS.flatMap((root) => files(join(process.cwd(), root)));

  it('finds the sources it checks', () => expect(sources.length).toBeGreaterThan(50));

  it('has no amber or orange colour anywhere in the frontend or the desktop app', () => {
    const offenders: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(COLOR)) {
        const rgb = parse(match[0]);
        if (rgb && isAmber(rgb)) offenders.push(`${relative(process.cwd(), path)}: ${match[0]}`);
      }
      if (OLD_CLASSES.test(text)) offenders.push(`${relative(process.cwd(), path)}: ${text.match(OLD_CLASSES)![0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
