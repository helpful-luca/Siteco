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
    expect(strip).toContain('height: calc(var(--spacing) * 13 + var(--window-bar))');
  });

  it('keeps every kind of control out of the drag area', () => {
    const start = css.indexOf('html[data-desktop]\n  :is(');
    const noDrag = css.slice(start, css.indexOf('}', start));
    for (const control of ['button', 'a[href]', 'input', 'textarea', 'select', '[role=\'combobox\']', '[role=\'menuitem\']', '[data-no-drag]']) {
      expect(noDrag).toContain(control);
    }
    expect(noDrag).toContain('app-region: no-drag');
  });

  it('gives Windows a title bar for its own buttons and keeps the traffic light inset on a Mac', () => {
    expect(rule('html[data-desktop]')).toContain('--titlebar-inset: 28px');
    const windows = rule("html[data-desktop][data-platform='win32']");
    expect(windows).toContain('--titlebar-inset: 0px');
    expect(windows).toContain('--window-bar: 32px');
  });
});
