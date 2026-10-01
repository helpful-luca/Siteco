/**
 * The Electron shell exposes `window.desktop` from its preload script, which runs before any
 * page script. This inline script marks <html data-desktop data-platform> before first paint,
 * so the title bar leaves room for the traffic lights (macOS) or the window buttons (Windows)
 * without a layout jump. In a browser it does nothing.
 */
export type DesktopWindowControls = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  openMenu: () => Promise<void>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
};

export type DesktopBridge = {
  isDesktop?: boolean;
  platform?: string;
  window?: DesktopWindowControls;
};

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const DESKTOP_SCRIPT = `(()=>{try{var d=window.desktop;if(d&&d.isDesktop){var h=document.documentElement;h.setAttribute('data-desktop','');if(typeof d.platform==='string'&&/^[a-z0-9]{1,16}$/.test(d.platform))h.setAttribute('data-platform',d.platform)}}catch(e){}})();`;
