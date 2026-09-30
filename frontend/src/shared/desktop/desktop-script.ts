/**
 * The Electron shell (phase 12) exposes `window.desktop` from its preload script, which runs
 * before any page script. This inline script marks <html data-desktop> before first paint, so
 * the title bar leaves room for the traffic lights without a layout jump. In a browser it does
 * nothing.
 */
declare global {
  interface Window {
    desktop?: { isDesktop?: boolean };
  }
}

export const DESKTOP_SCRIPT = `(()=>{try{if(window.desktop&&window.desktop.isDesktop)document.documentElement.setAttribute('data-desktop','')}catch(e){}})();`;
