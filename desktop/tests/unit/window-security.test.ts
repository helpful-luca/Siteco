import { describe, expect, it } from 'vitest';
import {
  allowPermission,
  externalUrl,
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
