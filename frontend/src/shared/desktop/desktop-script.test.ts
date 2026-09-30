import { afterEach, describe, expect, it } from 'vitest';
import { DESKTOP_SCRIPT } from './desktop-script';

const run = () => new Function(DESKTOP_SCRIPT)();

describe('desktop script', () => {
  afterEach(() => {
    delete window.desktop;
    document.documentElement.removeAttribute('data-desktop');
  });

  it('marks the document inside the desktop app', () => {
    window.desktop = { isDesktop: true };
    run();
    expect(document.documentElement).toHaveAttribute('data-desktop');
  });

  it('does nothing in a browser', () => {
    run();
    expect(document.documentElement).not.toHaveAttribute('data-desktop');
  });
});
