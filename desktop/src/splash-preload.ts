import { contextBridge, ipcRenderer } from 'electron';

/*
 * Bridge for the splash page only (never loaded into the app window). A sandboxed preload
 * cannot import local modules, so the channel names are repeated from splash-ipc.ts.
 */
contextBridge.exposeInMainWorld(
  'splash',
  Object.freeze({
    init: () => ipcRenderer.invoke('splash:init'),
    onState: (callback: (state: unknown) => void) => {
      ipcRenderer.on('splash:state', (_event, state: unknown) => callback(state));
    },
    action: (name: string) => ipcRenderer.invoke('splash:action', name),
  }),
);
