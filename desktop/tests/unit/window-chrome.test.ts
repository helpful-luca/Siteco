import { describe, expect, it } from 'vitest';
import { splashChrome, windowChrome } from '../../src/window-chrome';

describe('windowChrome', () => {
  it('keeps the native traffic lights on a Mac, inset into the title bar', () => {
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 24, y: 22 } });
  });

  it('draws its own title bar on Windows: frameless, rounded on Windows 11, no menu bar', () => {
    const chrome = windowChrome('win32');
    expect(chrome).toMatchObject({ frame: false, roundedCorners: true, autoHideMenuBar: true });
    // No transparent window: it would cost snap, the shadow and resizing at the edges.
    expect(chrome).not.toHaveProperty('transparent');
    expect(chrome).not.toHaveProperty('thickFrame', false);
  });

  it('keeps the system frame on Linux', () => {
    expect(windowChrome('linux')).toEqual({ autoHideMenuBar: true });
  });
});

describe('splashChrome', () => {
  it('uses the native window buttons as an overlay on Windows', () => {
    expect(splashChrome('win32', '#000000', '#ffffff')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 32 },
      autoHideMenuBar: true,
    });
    expect(splashChrome('darwin', '#000000', '#ffffff')).toEqual({ titleBarStyle: 'hiddenInset' });
  });
});
