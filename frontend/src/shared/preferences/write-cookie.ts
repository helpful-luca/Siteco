const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** One cookie of the preference mirror, readable by the server on the next render. */
export function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${ONE_YEAR_S}; path=/; samesite=lax`;
}

export function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return entry?.slice(prefix.length);
}
