import { contextBridge, ipcRenderer } from 'electron';

/*
 * The app window's only bridge: the commands behind the page's own window buttons, no Node APIs,
 * no generic IPC. The main process accepts them only from the app window's main frame on the app
 * origin. A sandboxed preload cannot import local modules, so the channel names repeat
 * window-ipc.ts.
 */
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    window: Object.freeze({
      minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
      toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
      close: (): Promise<void> => ipcRenderer.invoke('window:close'),
      isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
      onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
        const listener = (_event: unknown, maximized: unknown) => callback(maximized === true);
        ipcRenderer.on('window:maximized', listener);
        return () => void ipcRenderer.removeListener('window:maximized', listener);
      },
    }),
  }),
);
