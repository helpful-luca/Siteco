import { contextBridge } from 'electron';

/**
 * The app window's only bridge: the UI marks <html data-desktop> before first paint and leaves
 * room for the traffic lights (frontend/src/shared/desktop). No IPC, no Node APIs.
 */
contextBridge.exposeInMainWorld('desktop', Object.freeze({ isDesktop: true, platform: process.platform }));
