import { describe, expect, it } from 'vitest';
import { captionOverlay, splashChrome, TRAFFIC_LIGHTS, windowChrome } from '../../src/window-chrome';

const COLORS = { color: '#f2f2f5', symbolColor: '#1d1d1f' };

describe('windowChrome', () => {
  it('keeps only the native traffic lights on a Mac, on the first row of the sidebar', () => {
    expect(windowChrome('darwin', COLORS)).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS });
  });

  it('centres the lights on the sidebar row axis (y = 40) with equal inset from its left edge and top', () => {
    // Button frame 14 x 16 with a 12 px circle; the sidebar glass starts at x = 12, y = 12.
    const circleTop = TRAFFIC_LIGHTS.y + 2;
    const circleLeft = TRAFFIC_LIGHTS.x + 1;
    expect(TRAFFIC_LIGHTS.y + 8).toBe(40);
    expect(circleLeft - 12).toBe(circleTop - 12);
  });

  it('uses the native Windows caption buttons over a frameless window, in the 32 px title band', () => {
    const chrome = windowChrome('win32', COLORS);
    expect(chrome).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...COLORS, height: 32 },
      roundedCorners: true,
      autoHideMenuBar: true,
    });
    // No transparent window: it would cost snap, the shadow and resizing at the edges.
    expect(chrome).not.toHaveProperty('transparent');
    expect(chrome).not.toHaveProperty('frame', false);
  });

  it('keeps the system frame on Linux', () => {
    expect(windowChrome('linux', COLORS)).toEqual({ autoHideMenuBar: true });
  });
});

describe('captionOverlay', () => {
  it('follows the theme: canvas behind the buttons, ink for the symbols', () => {
    expect(captionOverlay('#000000', '#f5f5f7')).toEqual({ color: '#000000', symbolColor: '#f5f5f7', height: 32 });
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
