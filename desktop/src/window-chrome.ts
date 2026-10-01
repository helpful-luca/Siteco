import type { BrowserWindowConstructorOptions } from 'electron';

type Chrome = Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'frame' | 'roundedCorners' | 'autoHideMenuBar'>;

/**
 * Frameless on macOS and Windows; the page draws its own window buttons
 * (frontend/src/features/shell/window-chrome.tsx). `titleBarStyle: 'hidden'` keeps the native
 * rounded corners, shadow and full screen on macOS. Linux keeps its system frame.
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
