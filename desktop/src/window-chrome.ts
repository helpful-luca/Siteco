import type { BrowserWindowConstructorOptions } from 'electron';

type Chrome = Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'frame' | 'roundedCorners' | 'autoHideMenuBar'>;

/**
 * Frameless on macOS and Windows: no system title bar, no title band. The page draws its own
 * window buttons in the top right corner (frontend shell/window-chrome.tsx), the same on both
 * platforms. macOS also hides its traffic lights (`setWindowButtonVisibility(false)` in main.ts);
 * `titleBarStyle: 'hidden'` keeps the native rounded corners, shadow and full screen. Windows 11
 * rounds the corners natively (DWM); Windows 10 keeps square corners with the normal shadow,
 * snap and edge resizing (no transparent window). Linux keeps its system frame.
 */
export function windowChrome(platform: NodeJS.Platform): Chrome {
  if (platform === 'darwin') return { frame: false, titleBarStyle: 'hidden' };
  if (platform === 'win32') return { frame: false, roundedCorners: true, autoHideMenuBar: true };
  return { autoHideMenuBar: true };
}

/** Whether the page draws the window buttons (frameless window) on this platform. */
export function ownWindowButtons(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}
