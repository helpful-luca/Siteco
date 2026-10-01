import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../src/i18n';
import { menuTemplate, type MenuActions } from '../../src/menu';

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])]);
}

const actions = (overrides: Partial<MenuActions> = {}): MenuActions => ({
  dev: false,
  appReady: true,
  openSettings: vi.fn(),
  stopServices: vi.fn(),
  ...overrides,
});

describe('menuTemplate', () => {
  it('has the app, edit, view and window menus, no help menu', () => {
    const labels = menuTemplate(MESSAGES.de, actions()).map((item) => item.label);
    expect(labels).toEqual(['Siteco Document Chat', 'Bearbeiten', 'Ansicht', 'Fenster']);
  });

  it('offers settings and stopping the services in the app menu', () => {
    const a = actions();
    const items = flatten(menuTemplate(MESSAGES.de, a));
    const settings = items.find((item) => item.label === 'Einstellungen …');
    expect(settings?.accelerator).toBe('CmdOrCtrl+,');
    const stop = items.find((item) => item.label === 'Dienste beenden');
    (stop?.click as () => void)();
    expect(a.stopServices).toHaveBeenCalled();
  });

  it('shows developer tools only in development, and no services to stop there', () => {
    const prod = flatten(menuTemplate(MESSAGES.en, actions()));
    expect(prod.some((item) => item.role === 'toggleDevTools')).toBe(false);
    const dev = flatten(menuTemplate(MESSAGES.en, actions({ dev: true })));
    expect(dev.some((item) => item.role === 'toggleDevTools')).toBe(true);
    expect(dev.some((item) => item.label === 'Stop services')).toBe(false);
  });

  it('disables settings until the app is loaded', () => {
    const items = flatten(menuTemplate(MESSAGES.en, actions({ appReady: false })));
    expect(items.find((item) => item.label === 'Settings…')?.enabled).toBe(false);
  });
});
