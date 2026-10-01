import type { MenuItemConstructorOptions } from 'electron';
import type { Messages } from './i18n';

export interface MenuActions {
  /** Development (`npm run dev`): developer tools, and no compose services to stop. */
  dev: boolean;
  appReady: boolean;
  openSettings: () => void;
  stopServices: () => void;
}

/** The native menu bar (DE/EN). No Help menu: the app explains itself, the README is on GitHub. */
export function menuTemplate(t: Messages, actions: MenuActions): MenuItemConstructorOptions[] {
  const m = t.menu;
  const appMenu: MenuItemConstructorOptions[] = [
    { label: m.about, role: 'about' },
    { type: 'separator' },
    { label: m.settings, accelerator: 'CmdOrCtrl+,', enabled: actions.appReady, click: actions.openSettings },
    ...(actions.dev ? [] : ([{ label: m.stopServices, click: actions.stopServices }] as MenuItemConstructorOptions[])),
    { type: 'separator' },
    { label: m.hide, role: 'hide' },
    { label: m.hideOthers, role: 'hideOthers' },
    { label: m.showAll, role: 'unhide' },
    { type: 'separator' },
    { label: m.quit, role: 'quit' },
  ];
  const view: MenuItemConstructorOptions[] = [
    { label: m.reload, role: 'reload' },
    { type: 'separator' },
    { label: m.actualSize, role: 'resetZoom' },
    { label: m.zoomIn, role: 'zoomIn' },
    { label: m.zoomOut, role: 'zoomOut' },
    { type: 'separator' },
    { label: m.fullScreen, role: 'togglefullscreen' },
    ...(actions.dev
      ? ([{ type: 'separator' }, { label: m.devTools, role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
      : []),
  ];
  return [
    { label: t.appName, submenu: appMenu },
    {
      label: m.edit,
      submenu: [
        { label: m.undo, role: 'undo' },
        { label: m.redo, role: 'redo' },
        { type: 'separator' },
        { label: m.cut, role: 'cut' },
        { label: m.copy, role: 'copy' },
        { label: m.paste, role: 'paste' },
        { label: m.pasteAndMatchStyle, role: 'pasteAndMatchStyle' },
        { label: m.delete, role: 'delete' },
        { label: m.selectAll, role: 'selectAll' },
      ],
    },
    { label: m.view, submenu: view },
    {
      label: m.window,
      role: 'window',
      submenu: [
        { label: m.minimize, role: 'minimize' },
        { label: m.zoom, role: 'zoom' },
        { type: 'separator' },
        { label: m.front, role: 'front' },
      ],
    },
  ];
}
