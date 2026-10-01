import type { BrowserWindowConstructorOptions } from 'electron';

/** Aligns the traffic lights with the sidebar's search field (inside the 28 px title bar inset). */
const TRAFFIC_LIGHTS = { x: 24, y: 22 } as const;
/** Height of the Windows caption buttons (the app's own and the splash's native overlay). */
export const WINDOWS_CAPTION_HEIGHT = 32;

type Chrome = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'frame' | 'roundedCorners' | 'autoHideMenuBar' | 'titleBarOverlay'
>;

/**
 * Title bar of the app window per platform. macOS: native traffic lights over the content.
 * Windows: no system title bar; the app draws its buttons and drag strip (frontend shell).
 * Windows 11 rounds the corners natively (DWM); Windows 10 keeps square corners with the
 * normal shadow, snap and edge resizing (no transparent window).
 */
export function windowChrome(platform: NodeJS.Platform): Chrome {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS };
  if (platform === 'win32') return { frame: false, roundedCorners: true, autoHideMenuBar: true };
  return { autoHideMenuBar: true };
}

/** The splash has no app shell: on Windows it gets the native caption buttons as an overlay. */
export function splashChrome(platform: NodeJS.Platform, color: string, symbolColor: string): Chrome {
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color, symbolColor, height: WINDOWS_CAPTION_HEIGHT },
      autoHideMenuBar: true,
    };
  }
  return { titleBarStyle: 'hiddenInset' };
}
