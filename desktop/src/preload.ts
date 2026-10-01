import { contextBridge, ipcRenderer } from 'electron';

/*
 * The app window's only bridge. The UI marks <html data-desktop data-platform> before first
 * paint (frontend/src/shared/desktop). The window buttons are native on both platforms; the page
 * can only open the app menu (Windows has no menu bar). No Node APIs, no generic IPC; the main
 * process checks that the call comes from the app window's main frame on the app origin. A
 * sandboxed preload cannot import local modules, so the channel names repeat window-ipc.ts.
 */
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    window: Object.freeze({
      openMenu: (): Promise<void> => ipcRenderer.invoke('window:menu'),
    }),
  }),
);

/*
 * Full screen: no traffic lights (macOS) or caption buttons (Windows), so the page drops their
 * inset. A data attribute on <html>, set from here: the page needs no listener of its own.
 */
ipcRenderer.on('window:full-screen', (_event, fullScreen: unknown) => {
  document.documentElement?.toggleAttribute('data-full-screen', fullScreen === true);
});
