/** Inline script for theme "system": applies dark mode before first paint and follows changes. */
export const THEME_SCRIPT = `(()=>{try{var m=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){document.documentElement.classList.toggle('dark',m.matches)};a();m.addEventListener('change',a)}catch(e){}})();`;
