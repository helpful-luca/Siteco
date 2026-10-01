import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('desktop window chrome', () => {
  it('turns the top strip into a drag area only in the desktop app, under the page', () => {
    expect(rule('.window-drag-strip')).toContain('display: none');
    const strip = rule('html[data-desktop] .window-drag-strip');
    expect(strip).toContain('app-region: drag');
    expect(strip).toContain('position: fixed');
    expect(strip).toContain('z-index: -1');
    expect(strip).toContain("height: calc(var(--spacing) * 14 + var(--window-bar))");
  });

  it('keeps every kind of control out of the drag area', () => {
    const start = css.indexOf('html[data-desktop]\n  :is(');
    const noDrag = css.slice(start, css.indexOf('}', start));
    for (const control of ['button', 'a[href]', 'input', 'textarea', 'select', '[role=\'combobox\']', '[role=\'menuitem\']', '[data-no-drag]']) {
      expect(noDrag).toContain(control);
    }
    expect(noDrag).toContain('app-region: no-drag');
  });

  it('makes room for the traffic lights on a Mac window, not in full screen', () => {
    const mac = rule("html[data-desktop][data-platform='darwin']:not([data-full-screen])");
    // The narrow-window top bar centres on the lights' axis (y = 40) and starts right of them.
    expect(mac).toContain('--titlebar-inset: 16px');
    expect(mac).toContain('--traffic-lights: 88px');
    // The drawer sidebar sits where the wide sidebar does, so its first row holds the lights.
    expect(mac).toContain('--sheet-inset: 12px');
    expect(css).toContain("@custom-variant mac-window (&:where(html[data-desktop][data-platform='darwin']:not([data-full-screen]) *));");
  });

  it('gives Windows a 32 px title band for the native caption buttons, not in full screen', () => {
    const windows = rule("html[data-desktop][data-platform='win32']:not([data-full-screen])");
    expect(windows).toContain('--window-bar: 32px');
    expect(css).toContain("@custom-variant win-window (&:where(html[data-desktop][data-platform='win32']:not([data-full-screen]) *));");
  });
});
