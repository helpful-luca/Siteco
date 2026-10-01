import { describe, expect, it } from 'vitest';
import { isFromAppWindow, WINDOW_CHANNELS } from '../../src/window-ipc';

const APP = 'http://localhost:3000';
const contents = { id: 1 };
const other = { id: 2 };

describe('isFromAppWindow', () => {
  it('accepts the app window on the app origin', () => {
    expect(isFromAppWindow({ sender: contents, frameUrl: `${APP}/chat`, mainFrame: true }, contents, APP)).toBe(true);
  });

  it('rejects other windows, other origins, the splash and a closed window', () => {
    expect(isFromAppWindow({ sender: other, frameUrl: `${APP}/chat`, mainFrame: true }, contents, APP)).toBe(false);
    expect(isFromAppWindow({ sender: contents, frameUrl: 'https://example.com/', mainFrame: true }, contents, APP)).toBe(false);
    expect(isFromAppWindow({ sender: contents, frameUrl: 'docchat://app/splash.html', mainFrame: true }, contents, APP)).toBe(false);
    expect(isFromAppWindow({ sender: contents, frameUrl: undefined, mainFrame: true }, contents, APP)).toBe(false);
    expect(isFromAppWindow({ sender: contents, frameUrl: `${APP}/`, mainFrame: true }, undefined, APP)).toBe(false);
    expect(isFromAppWindow({ sender: contents, frameUrl: `${APP}/x`, mainFrame: false }, contents, APP)).toBe(false);
  });
});

describe('WINDOW_CHANNELS', () => {
  it('is the small fixed set the preload repeats', () => {
    expect(Object.values(WINDOW_CHANNELS).sort()).toEqual([
      'window:close',
      'window:is-maximized',
      'window:maximized',
      'window:menu',
      'window:minimize',
      'window:toggle-maximize',
    ]);
  });
});
