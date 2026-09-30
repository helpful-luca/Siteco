import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from the frontend root.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

function px(token: string): number {
  const match = css.match(new RegExp(`--${token}:\\s*(\\d+)px;`));
  if (!match) throw new Error(`missing token --${token}`);
  return Number(match[1]);
}

describe('spacing and layout rules', () => {
  it('keeps the 16 px root, so the rem based spacing scale stays on the 4 px grid', () => {
    const html = css.slice(css.indexOf('  html {'), css.indexOf('}', css.indexOf('  html {')));
    expect(html).not.toMatch(/font-size/);
  });

  it.each(['radius-panel', 'radius-card', 'radius-control', 'radius-inner', 'spacing-sidebar', 'spacing-panel'])(
    '%s sits on the 4 px grid',
    (token) => {
      expect(px(token) % 4).toBe(0);
    },
  );

  it('keeps radii concentric for the insets we use', () => {
    // Sidebar and drop overlay: panel with p-3 (12 px) around controls.
    expect(px('radius-panel') - 12).toBe(px('radius-control'));
    // Panel with p-2 (8 px) around cards, cards with p-2 around inner surfaces.
    expect(px('radius-panel') - 8).toBe(px('radius-card'));
    expect(px('radius-card') - 8).toBe(px('radius-inner'));
  });

  it('uses scale steps instead of arbitrary pixel spacing in components', () => {
    const spacing = /\b-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[\d+(?:\.\d+)?px\]/g;
    const offenders = sourceFiles(join(process.cwd(), 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(spacing)].map((m) => `${file.split('/src/')[1]}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
