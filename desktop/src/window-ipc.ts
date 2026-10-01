import { isAppUrl } from './window-security';

/**
 * Window controls for the app's own title bar (Windows) and double click on the drag strip.
 * Shared by the main process and (repeated, a sandboxed preload cannot import) preload.ts.
 */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  /** Main to page: the maximized state changed. */
  maximized: 'window:maximized',
  /** Opens the app menu as a popup (Windows has no menu bar). */
  menu: 'window:menu',
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
