import { contextBridge, ipcRenderer } from 'electron';

/*
 * The app window's only bridge. The UI marks <html data-desktop data-platform> before first
 * paint (frontend/src/shared/desktop) and, on Windows, draws its own window buttons. A few
 * window commands, nothing else: no Node APIs, no generic IPC. The main process checks that
 * every call comes from the app window's main frame on the app origin. A sandboxed preload
 * cannot import local modules, so the channel names are repeated from window-ipc.ts.
 */
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    window: Object.freeze({
      minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
      toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
      close: (): Promise<void> => ipcRenderer.invoke('window:close'),
      isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
      openMenu: (): Promise<void> => ipcRenderer.invoke('window:menu'),
      onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
        const listener = (_event: unknown, maximized: unknown) => callback(maximized === true);
        ipcRenderer.on('window:maximized', listener);
        return () => void ipcRenderer.removeListener('window:maximized', listener);
      },
    }),
  }),
);
