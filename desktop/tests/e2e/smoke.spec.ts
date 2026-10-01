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

    // The preload bridge is all the page gets: a few window commands, no Node, no generic IPC.
    const bridge = await page.evaluate(() => {
      const desktop = (window as unknown as { desktop: Record<string, unknown> }).desktop;
      const controls = desktop.window as Record<string, unknown>;
      return {
        isDesktop: desktop.isDesktop,
        platform: desktop.platform,
        keys: Object.keys(desktop).sort(),
        window: Object.keys(controls).sort(),
        frozen: Object.isFrozen(desktop) && Object.isFrozen(controls),
      };
    });
    expect(bridge).toEqual({
      isDesktop: true,
      platform: process.platform,
      keys: ['isDesktop', 'platform', 'window'],
      window: ['close', 'isMaximized', 'minimize', 'onMaximizedChange', 'openMenu', 'toggleMaximize'],
      frozen: true,
    });
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');

    // The UI leaves room for the traffic lights and drags the window by its top strip.
    await expect(page.locator('html')).toHaveAttribute('data-desktop', '');
    await expect(page.locator('html')).toHaveAttribute('data-platform', process.platform);
    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--titlebar-inset').trim(),
    );
    expect(inset).toBe(process.platform === 'darwin' ? '28px' : '0px');
    const strip = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('.window-drag-strip')!;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      // Before every control in the document, so Electron cuts the controls out of it.
      const controls = Array.from(document.querySelectorAll('button, a[href], input, [role]'));
      return {
        first: controls.every((control) => element.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING),
        region: style.getPropertyValue('app-region') || style.getPropertyValue('-webkit-app-region'),
        zIndex: style.zIndex,
        top: box.top,
        height: box.height,
        width: box.width,
      };
    });
    expect(strip).toMatchObject({ first: true, region: 'drag', zIndex: '-1', top: 0, height: process.platform === 'win32' ? 84 : 52 });
    expect(strip.width).toBe(await page.evaluate(() => window.innerWidth));

    // Every control in the strip is cut out of the drag area: search, new chat, pickers, links.
    await page.locator('aside input').first().waitFor();
    const draggableControls = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, textarea, [role="combobox"]'))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.top < 52;
        })
        .map((element) => {
          const style = getComputedStyle(element);
          return { name: element.getAttribute('aria-label') ?? element.textContent, region: style.getPropertyValue('app-region') || style.getPropertyValue('-webkit-app-region') };
        })
        .filter((control) => control.region !== 'no-drag'),
    );
    expect(draggableControls).toEqual([]);

    // Window commands from the page reach the window (double click and the Windows buttons).
    const maximizedBefore = await page.evaluate(() =>
      (window as unknown as { desktop: { window: { isMaximized(): Promise<boolean> } } }).desktop.window.isMaximized(),
    );
    expect(typeof maximizedBefore).toBe('boolean');
    const toggled = await page.evaluate(() =>
      (window as unknown as { desktop: { window: { toggleMaximize(): Promise<boolean> } } }).desktop.window.toggleMaximize(),
    );
    expect(toggled).toBe(!maximizedBefore);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isMaximized()))).toBe(
      toggled,
    );
    await page.evaluate(() =>
      (window as unknown as { desktop: { window: { toggleMaximize(): Promise<boolean> } } }).desktop.window.toggleMaximize(),
    );

    // Window rules: popups are denied.
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);

    // A plain external link (no target) stays out of the window and goes to the default browser.
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = async (url: string) => void opened.push(url);
    });
    const before = page.url();
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = 'https://www.siteco.com/';
      document.body.append(link);
      link.click();
      link.remove();
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['https://www.siteco.com/']);
    expect(page.url()).toBe(before);

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
