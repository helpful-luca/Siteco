import type { Session, WebContents } from 'electron';

/**
 * Every navigation, popup, permission and network rule in one place (annex 11, 8.13).
 * The pure functions are unit tested; `hardenSession` and `hardenContents` wire them up.
 */

/** The splash page is served from the app bundle under its own privileged scheme, not file://. */
export const SPLASH_SCHEME = 'docchat';
export const SPLASH_ORIGIN = `${SPLASH_SCHEME}://app`;
export const SPLASH_PATH = '/splash.html';

const MAX_EXTERNAL_URL = 2048;
/** The copy buttons need it; the app origin only. */
const APP_PERMISSIONS = new Set(['clipboard-sanitized-write']);

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function isAppUrl(url: string, appOrigin: string): boolean {
  return parse(url)?.origin === appOrigin;
}

export function isSplashUrl(url: string): boolean {
  const parsed = parse(url);
  return parsed?.protocol === `${SPLASH_SCHEME}:` && parsed.host === 'app' && parsed.pathname === SPLASH_PATH;
}

/** A link worth handing to the default browser: http(s), another origin, no credentials. */
export function externalUrl(url: string, appOrigin: string): string | undefined {
  if (url.length > MAX_EXTERNAL_URL) return undefined;
  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return undefined;
  if (parsed.origin === appOrigin || parsed.username || parsed.password) return undefined;
  return parsed.href;
}

export function allowPermission(permission: string, requestingOrigin: string, appOrigin: string): boolean {
  return APP_PERMISSIONS.has(permission) && requestingOrigin === appOrigin;
}

/** No remote content: only the app origin (and its dev websocket), the splash page and in-page data. */
export function isAllowedRequest(url: string, appOrigin: string): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  switch (parsed.protocol) {
    case 'http:':
      return parsed.origin === appOrigin;
    case 'ws:':
      return `http://${parsed.host}` === appOrigin;
    case 'blob:':
      return isAppUrl(url.slice('blob:'.length), appOrigin);
    case 'data:':
    case 'devtools:':
      return true;
    case `${SPLASH_SCHEME}:`:
      return parsed.host === 'app';
    default:
      return false;
  }
}

export function hardenSession(session: Session, appOrigin: string): void {
  session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowPermission(permission, parse(contents.getURL())?.origin ?? '', appOrigin));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    allowPermission(permission, requestingOrigin, appOrigin),
  );
  session.setDevicePermissionHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, appOrigin) });
  });
}

/**
 * Applies to every web contents: the app window may navigate within the app origin, the
 * splash only to itself; popups are denied and http(s) links go to the default browser.
 */
export function hardenContents(
  contents: WebContents,
  appOrigin: string,
  openExternal: (url: string) => void,
): void {
  const mayNavigate = (url: string) => isAppUrl(url, appOrigin) || isSplashUrl(url);
  const guard = (event: { preventDefault: () => void }, url: string) => {
    if (mayNavigate(url)) return;
    event.preventDefault();
    const external = externalUrl(url, appOrigin);
    if (external) openExternal(external);
  };
  contents.on('will-navigate', guard);
  contents.on('will-frame-navigate', (event) => {
    if (!mayNavigate(event.url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!mayNavigate(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url, appOrigin);
    if (external) setImmediate(() => openExternal(external));
    return { action: 'deny' };
  });
}
