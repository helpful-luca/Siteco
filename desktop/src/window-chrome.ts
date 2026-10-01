import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from 'electron';

/**
 * Traffic lights on the first row of the glass sidebar (frontend shell/sidebar.tsx), like Notes
 * and Mail. The window buttons' frame is 14 x 16 pt with a 12 pt circle; the sidebar glass starts
 * at x = 12, y = 12 and its first row is centred on y = 40, the axis of every toolbar row in the
 * app. y = 32 puts the circles' centre on that axis, x = 33 gives them the same 22 px inset from
 * the sidebar's left edge as from its top.
 */
export const TRAFFIC_LIGHTS = { x: 33, y: 32 } as const;
/** Windows title band with the native caption buttons (frontend --window-bar). */
export const WINDOWS_CAPTION_HEIGHT = 32;

type Chrome = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'frame' | 'roundedCorners' | 'autoHideMenuBar' | 'titleBarOverlay'
>;

/** The native Windows caption buttons over the app: canvas behind them, ink for the symbols. */
export function captionOverlay(color: string, symbolColor: string): TitleBarOverlayOptions {
  return { color, symbolColor, height: WINDOWS_CAPTION_HEIGHT };
}

/**
 * Title bar of the app window per platform. Only native window buttons, never drawn ones.
 * macOS: the traffic lights over the content. Windows: no system title bar, the native caption
 * buttons (with Snap Layouts) as an overlay in the app's 32 px title band, colours following the
 * theme. Windows 11 rounds the corners natively (DWM); Windows 10 keeps square corners with the
 * normal shadow, snap and edge resizing (no transparent window).
 */
export function windowChrome(platform: NodeJS.Platform, colors: { color: string; symbolColor: string }): Chrome {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS };
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: captionOverlay(colors.color, colors.symbolColor),
      roundedCorners: true,
      autoHideMenuBar: true,
    };
  }
  return { autoHideMenuBar: true };
}

/** The splash has no app shell: on Windows it gets the native caption buttons as an overlay. */
export function splashChrome(platform: NodeJS.Platform, color: string, symbolColor: string): Chrome {
  if (platform === 'win32') {
    return { titleBarStyle: 'hidden', titleBarOverlay: captionOverlay(color, symbolColor), autoHideMenuBar: true };
  }
  return { titleBarStyle: 'hiddenInset' };
}
