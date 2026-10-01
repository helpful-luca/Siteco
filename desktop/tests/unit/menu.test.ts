import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../src/i18n';
import { menuTemplate, popupMenuTemplate, type MenuActions } from '../../src/menu';

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
    const labels = menuTemplate(MESSAGES.de, actions(), 'darwin').map((item) => item.label);
    expect(labels).toEqual(['Siteco Document Chat', 'Bearbeiten', 'Ansicht', 'Fenster']);
  });

  it('offers settings and stopping the services in the app menu', () => {
    const a = actions();
    const items = flatten(menuTemplate(MESSAGES.de, a, 'darwin'));
    const settings = items.find((item) => item.label === 'Einstellungen …');
    expect(settings?.accelerator).toBe('CmdOrCtrl+,');
    const stop = items.find((item) => item.label === 'Dienste beenden');
    (stop?.click as () => void)();
    expect(a.stopServices).toHaveBeenCalled();
  });

  it('shows developer tools only in development, and no services to stop there', () => {
    const prod = flatten(menuTemplate(MESSAGES.en, actions(), 'darwin'));
    expect(prod.some((item) => item.role === 'toggleDevTools')).toBe(false);
    const dev = flatten(menuTemplate(MESSAGES.en, actions({ dev: true }), 'darwin'));
    expect(dev.some((item) => item.role === 'toggleDevTools')).toBe(true);
    expect(dev.some((item) => item.label === 'Stop services')).toBe(false);
  });

  it('disables settings until the app is loaded', () => {
    const items = flatten(menuTemplate(MESSAGES.en, actions({ appReady: false }), 'darwin'));
    expect(items.find((item) => item.label === 'Settings…')?.enabled).toBe(false);
  });
});

describe('on Windows', () => {
  it('keeps the commands in one menu without macOS items', () => {
    const items = flatten(menuTemplate(MESSAGES.de, actions(), 'win32'));
    const roles = items.map((item) => item.role).filter(Boolean);
    expect(roles).not.toContain('hide');
    expect(roles).not.toContain('front');
    expect(items.find((item) => item.label === 'Einstellungen …')?.accelerator).toBe('CmdOrCtrl+,');
    expect(items.find((item) => item.role === 'quit')?.label).toBe('Beenden');
  });

  it('offers settings, view, about, stopping the services and quitting in the popup', () => {
    const a = actions();
    const items = popupMenuTemplate(MESSAGES.en, a);
    const labels = items.filter((item) => item.type !== 'separator').map((item) => item.label);
    expect(labels).toEqual([
      'Settings…',
      'Reload',
      'Actual size',
      'Zoom in',
      'Zoom out',
      'Full screen',
      'About Siteco Document Chat',
      'Stop services',
      'Quit',
    ]);
    (items.find((item) => item.label === 'Stop services')?.click as () => void)();
    expect(a.stopServices).toHaveBeenCalled();
  });
});
