import { isAppUrl } from './window-security';

/** Channels for the page's own window buttons. preload.ts repeats the names (it cannot import). */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  /** Main to page: the window was maximized, restored, or entered or left full screen. */
  maximized: 'window:maximized',
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
