'use client';

import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDesktop } from '@/shared/desktop/use-desktop';
import { Button } from '@/shared/ui';

/**
 * The top strip of the desktop window: it moves the window, and a double click maximizes it
 * (native on both platforms). One fixed element, first in the document and painted under the
 * page: Electron adds the drag area first and then cuts out every `no-drag` control, so
 * buttons, fields and links in the strip stay clickable (globals.css). Hidden outside the
 * desktop app.
 */
export function WindowDragStrip() {
  return <div aria-hidden="true" className="window-drag-strip" />;
}

/**
 * The Windows title band (32 px, --window-bar): the app menu and the app name on the left, the
 * native caption buttons on the right (Electron titleBarOverlay, with Snap Layouts), so no window
 * button is drawn here. macOS keeps its traffic lights, a browser has neither: nothing renders.
 */
export function WindowTitleBar() {
  const t = useTranslations('shell.window');
  const tApp = useTranslations('app');
  const desktop = useDesktop();
  const bridge = desktop?.platform === 'win32' ? desktop.window : undefined;
  if (!bridge) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-100 hidden h-(--window-bar) items-center gap-1 pl-2 win-window:flex">
      <div data-no-drag="">
        <Button icon size="sm" variant="ghost" aria-label={t('menu')} onClick={() => void bridge.openMenu()}>
          <Ellipsis />
        </Button>
      </div>
      <span className="truncate text-caption text-ink-muted">{tApp('name')}</span>
    </div>
  );
}
