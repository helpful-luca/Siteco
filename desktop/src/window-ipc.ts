import { isAppUrl } from './window-security';

/**
 * The app window's channels. The window buttons are native on both platforms, so only the app
 * menu (Windows has no menu bar) and the full screen state cross the bridge. Shared by the main
 * process and (repeated, a sandboxed preload cannot import) preload.ts.
 */
export const WINDOW_CHANNELS = {
  /** Page to main: opens the app menu as a popup. */
  menu: 'window:menu',
  /** Main to page: the window entered or left full screen (no title bar inset there). */
  fullScreen: 'window:full-screen',
} as const;

/** Only the app window's main frame on the app origin may control the window. */
export function isFromAppWindow<T>(
  event: { sender: T; frameUrl: string | undefined; mainFrame: boolean },
  appContents: T | undefined,
  appOrigin: string,
): boolean {
  return (
    appContents !== undefined &&
    event.sender === appContents &&
    event.mainFrame &&
    isAppUrl(event.frameUrl ?? '', appOrigin)
  );
}
