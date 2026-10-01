import { afterEach, describe, expect, it } from 'vitest';
import { DESKTOP_SCRIPT } from './desktop-script';

const run = () => new Function(DESKTOP_SCRIPT)();

describe('desktop script', () => {
  afterEach(() => {
    delete window.desktop;
    document.documentElement.removeAttribute('data-desktop');
    document.documentElement.removeAttribute('data-platform');
  });

  it('marks the document inside the desktop app', () => {
    window.desktop = { isDesktop: true };
    run();
    expect(document.documentElement).toHaveAttribute('data-desktop');
  });

  it('names the platform, so Windows gets its own title bar', () => {
    window.desktop = { isDesktop: true, platform: 'win32' };
    run();
    expect(document.documentElement).toHaveAttribute('data-platform', 'win32');
  });

  it('ignores an odd platform value', () => {
    window.desktop = { isDesktop: true, platform: 'x" onload="1' };
    run();
    expect(document.documentElement).toHaveAttribute('data-desktop');
    expect(document.documentElement).not.toHaveAttribute('data-platform');
  });

  it('does nothing in a browser', () => {
    run();
    expect(document.documentElement).not.toHaveAttribute('data-desktop');
  });
});
