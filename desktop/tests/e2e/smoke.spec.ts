import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { appUrl } from '../../src/config';
import { probeServer } from '../../src/server-probe';

/*
 * Launches the real Electron app against a running stack (docker compose or `npm run dev`):
 * splash first, then the app window with the desktop title bar. Skips when nothing runs.
 */
const PORT = Number(process.env.DOCCHAT_PORT ?? 3000);
const URL = appUrl(PORT);

test('splash, then the app in a native window', async () => {
  test.skip((await probeServer(URL)) !== 'ours', `Siteco Document Chat is not running on ${URL}`);

  const userData = mkdtempSync(join(tmpdir(), 'docchat-e2e-'));
  const app = await electron.launch({
    args: ['.', '--dev'],
    cwd: join(__dirname, '../..'),
    env: { ...process.env, DOCCHAT_USER_DATA: userData, DOCCHAT_PORT: String(PORT), DOCCHAT_SPLASH: '1' },
  });
  try {
    const splash = await app.firstWindow();
    expect(splash.url()).toMatch(/^docchat:\/\/app\/splash\.html/);
    await expect(splash.locator('h1')).toHaveText('Siteco Document Chat');

    const page = await app.waitForEvent('window', { predicate: (page) => page.url().startsWith(URL) });
    await page.waitForLoadState('domcontentloaded');

    // The preload bridge is all the page gets: no Node, no IPC.
    expect(await page.evaluate(() => (window as unknown as { desktop: unknown }).desktop)).toEqual({
      isDesktop: true,
      platform: process.platform,
    });
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');

    // The UI leaves room for the traffic lights and drags the window by its title bar.
    await expect(page.locator('html')).toHaveAttribute('data-desktop', '');
    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--titlebar-inset').trim(),
    );
    expect(inset).toBe('28px');
    await expect(page.locator('.drag-region').first()).toBeAttached();

    // Window rules: popups are denied.
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);

    // The menu opens the settings in the same window.
    await app.evaluate(({ Menu }) => {
      const appMenu = Menu.getApplicationMenu()?.items[0]?.submenu;
      appMenu?.items.find((item) => item.accelerator === 'CmdOrCtrl+,')?.click();
    });
    await page.waitForURL(`${URL}/settings`);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
