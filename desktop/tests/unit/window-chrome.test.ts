import { describe, expect, it } from 'vitest';
import { ownWindowButtons, windowChrome } from '../../src/window-chrome';

describe('windowChrome', () => {
  it('is frameless on a Mac, keeping the native corners and full screen', () => {
    expect(windowChrome('darwin')).toEqual({ frame: false, titleBarStyle: 'hidden' });
  });

  it('is frameless on Windows with native rounded corners (Windows 11), no title band', () => {
    const chrome = windowChrome('win32');
    expect(chrome).toEqual({ frame: false, roundedCorners: true, autoHideMenuBar: true });
    // No transparent window: it would cost snap, the shadow and resizing at the edges.
    expect(chrome).not.toHaveProperty('transparent');
    expect(chrome).not.toHaveProperty('titleBarOverlay');
  });

  it('keeps the system frame on Linux', () => {
    expect(windowChrome('linux')).toEqual({ autoHideMenuBar: true });
  });
});

describe('ownWindowButtons', () => {
  it('draws the window buttons wherever the window is frameless', () => {
    expect(ownWindowButtons('darwin')).toBe(true);
    expect(ownWindowButtons('win32')).toBe(true);
    expect(ownWindowButtons('linux')).toBe(false);
  });
});
