import { describe, expect, it } from 'vitest';
import {
  allowPermission,
  externalUrl,
  hardenContents,
  isAllowedRequest,
  isAppUrl,
  isSplashUrl,
  SPLASH_ORIGIN,
} from '../../src/window-security';

const APP = 'http://localhost:3000';

describe('isAppUrl', () => {
  it('accepts only the app origin', () => {
    expect(isAppUrl('http://localhost:3000/chat/1', APP)).toBe(true);
    expect(isAppUrl('http://localhost:3000', APP)).toBe(true);
    expect(isAppUrl('http://localhost:3001/', APP)).toBe(false);
    expect(isAppUrl('http://127.0.0.1:3000/', APP)).toBe(false);
    expect(isAppUrl('https://localhost:3000/', APP)).toBe(false);
    expect(isAppUrl('http://localhost:3000@evil.com/', APP)).toBe(false);
    expect(isAppUrl('file:///etc/passwd', APP)).toBe(false);
    expect(isAppUrl('not a url', APP)).toBe(false);
  });
});

describe('isSplashUrl', () => {
  it('accepts only the bundled splash page', () => {
    expect(isSplashUrl(`${SPLASH_ORIGIN}/splash.html`)).toBe(true);
    expect(isSplashUrl(`${SPLASH_ORIGIN}/splash.html?x=1`)).toBe(true);
    expect(isSplashUrl(`${SPLASH_ORIGIN}/other.html`)).toBe(false);
    expect(isSplashUrl('file:///splash.html')).toBe(false);
  });
});

describe('externalUrl', () => {
  it('opens http and https links of other origins in the browser', () => {
    expect(externalUrl('https://www.siteco.com/de/produkte', APP)).toBe('https://www.siteco.com/de/produkte');
    expect(externalUrl('http://example.com', APP)).toBe('http://example.com/');
  });

  it('refuses everything else', () => {
    expect(externalUrl('http://localhost:3000/settings', APP)).toBeUndefined();
    expect(externalUrl('file:///Applications/Calculator.app', APP)).toBeUndefined();
    expect(externalUrl('javascript:alert(1)', APP)).toBeUndefined();
    expect(externalUrl('smb://server/share', APP)).toBeUndefined();
    expect(externalUrl('mailto:a@b.de', APP)).toBeUndefined();
    expect(externalUrl('https://user:pass@example.com/', APP)).toBeUndefined();
    expect(externalUrl('not a url', APP)).toBeUndefined();
    expect(externalUrl(`https://example.com/${'a'.repeat(3000)}`, APP)).toBeUndefined();
  });
});

describe('allowPermission', () => {
  it('denies every permission request', () => {
    for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'openExternal', 'fullscreen']) {
      expect(allowPermission(permission, APP, APP)).toBe(false);
    }
  });

  it('lets only the app write to the clipboard (the copy buttons)', () => {
    expect(allowPermission('clipboard-sanitized-write', APP, APP)).toBe(true);
    expect(allowPermission('clipboard-sanitized-write', 'https://evil.com', APP)).toBe(false);
    expect(allowPermission('clipboard-read', APP, APP)).toBe(false);
  });
});

describe('isAllowedRequest', () => {
  it('lets the app, the splash page and in-page data through', () => {
    expect(isAllowedRequest('http://localhost:3000/_next/static/chunk.js', APP)).toBe(true);
    expect(isAllowedRequest('ws://localhost:3000/_next/webpack-hmr', APP)).toBe(true);
    expect(isAllowedRequest(`${SPLASH_ORIGIN}/splash.css`, APP)).toBe(true);
    expect(isAllowedRequest('data:image/png;base64,AAAA', APP)).toBe(true);
    expect(isAllowedRequest('blob:http://localhost:3000/1234', APP)).toBe(true);
    expect(isAllowedRequest('devtools://devtools/bundled/inspector.html', APP)).toBe(true);
  });

  it('blocks remote content and other local servers', () => {
    expect(isAllowedRequest('https://fonts.googleapis.com/css2', APP)).toBe(false);
    expect(isAllowedRequest('http://localhost:8000/api/health/live', APP)).toBe(false);
    expect(isAllowedRequest('ws://evil.com/', APP)).toBe(false);
    expect(isAllowedRequest('blob:https://evil.com/1234', APP)).toBe(false);
    expect(isAllowedRequest('file:///etc/passwd', APP)).toBe(false);
  });
});

describe('hardenContents', () => {
  type Handler = (...args: unknown[]) => void;
  function fakeContents() {
    const handlers = new Map<string, Handler>();
    let openHandler: ((details: { url: string }) => { action: string }) | undefined;
    return {
      contents: {
        on: (name: string, handler: Handler) => handlers.set(name, handler),
        setWindowOpenHandler: (handler: typeof openHandler) => {
          openHandler = handler;
        },
      },
      navigate(url: string, isMainFrame: boolean) {
        let prevented = false;
        handlers.get('will-frame-navigate')?.({ url, isMainFrame, preventDefault: () => (prevented = true) });
        return prevented;
      },
      handlers,
      open: (url: string) => openHandler?.({ url }),
    };
  }

  async function setup() {
    const fake = fakeContents();
    const opened: string[] = [];
    hardenContents(fake.contents as never, APP, (url) => opened.push(url));
    return { fake, opened };
  }

  it('opens a plain external link of the main frame in the browser', async () => {
    const { fake, opened } = await setup();
    expect(fake.navigate('https://www.siteco.com/', true)).toBe(true);
    expect(opened).toEqual(['https://www.siteco.com/']);
  });

  it('lets the app navigate within its origin', async () => {
    const { fake, opened } = await setup();
    expect(fake.navigate('http://localhost:3000/library', true)).toBe(false);
    expect(fake.navigate(`${SPLASH_ORIGIN}/splash.html?lang=de`, true)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('blocks subframes and unsafe schemes without opening anything', async () => {
    const { fake, opened } = await setup();
    expect(fake.navigate('https://www.siteco.com/', false)).toBe(true);
    expect(fake.navigate('file:///etc/passwd', true)).toBe(true);
    expect(fake.navigate('javascript:alert(1)', true)).toBe(true);
    expect(opened).toEqual([]);
  });

  it('handles each navigation once (no second handler on will-navigate)', async () => {
    const { fake } = await setup();
    expect(fake.handlers.has('will-navigate')).toBe(false);
  });

  it('denies popups and hands valid links to the browser', async () => {
    const { fake, opened } = await setup();
    expect(fake.open('https://example.com/a')).toEqual({ action: 'deny' });
    expect(fake.open('file:///etc/passwd')).toEqual({ action: 'deny' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(opened).toEqual(['https://example.com/a']);
  });
});
