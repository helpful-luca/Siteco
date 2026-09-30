import { COOKIE_THEME, type Theme } from '@/shared/preferences/cookies';

const ONE_YEAR_S = 60 * 60 * 24 * 365;
let stopFollowingSystem: (() => void) | null = null;

/** Applies a theme immediately and remembers it in a cookie so the server renders it next time. */
export function applyTheme(theme: Theme): void {
  document.cookie = `${COOKIE_THEME}=${theme}; max-age=${ONE_YEAR_S}; path=/; samesite=lax`;
  stopFollowingSystem?.();
  stopFollowingSystem = null;

  const root = document.documentElement;
  if (theme !== 'system') {
    root.classList.toggle('dark', theme === 'dark');
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => root.classList.toggle('dark', media.matches);
  sync();
  media.addEventListener('change', sync);
  stopFollowingSystem = () => media.removeEventListener('change', sync);
}
