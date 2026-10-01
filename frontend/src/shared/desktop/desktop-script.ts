/**
 * The Electron shell exposes `window.desktop` from its preload script, which runs before any
 * page script. This inline script marks <html data-desktop data-platform> before first paint,
 * so the layout leaves room for the traffic lights (macOS) or the caption buttons (Windows)
 * without a layout jump. In a browser it does nothing.
 */
/** The window buttons are native; the page can only open the app menu (Windows). */
export type DesktopWindowControls = {
  openMenu: () => Promise<void>;
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
