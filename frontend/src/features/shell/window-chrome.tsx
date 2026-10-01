'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useDesktop } from '@/shared/desktop/use-desktop';

/**
 * The top strip of the desktop window: it moves the window. One fixed element, first in the
 * document and painted under the page: Electron adds the drag area first and then cuts out every
 * `no-drag` control, so buttons, fields and links in the strip stay clickable (globals.css).
 * Hidden outside the desktop app.
 */
export function WindowDragStrip() {
  return <div aria-hidden="true" className="window-drag-strip" />;
}

/** The colours of macOS window buttons, the same on Windows: one look for the app everywhere. */
const BUTTON_COLORS = { maximize: '#34c759', minimize: '#febc2e', close: '#ff5f57' } as const;

/**
 * Window buttons of the frameless desktop window (macOS and Windows): three 12 px circles in the
 * top right corner, maximize, minimize, close. A browser and Linux (system frame) render nothing.
 */
export function WindowControls() {
  const t = useTranslations('shell.window');
  const desktop = useDesktop();
  const controls = desktop?.platform === 'darwin' || desktop?.platform === 'win32' ? desktop.window : undefined;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    // An event that arrives first is newer than the answer to the initial question.
    let changed = false;
    const off = controls.onMaximizedChange((next) => {
      changed = true;
      setMaximized(next);
    });
    void controls.isMaximized().then((next) => !changed && setMaximized(next), () => undefined);
    return off;
  }, [controls]);

  if (!controls) return null;
  return (
    <div data-no-drag="" className="fixed top-0 right-0 z-100 flex h-8 items-center gap-1.5 pt-2 pr-3">
      <WindowButton
        color={BUTTON_COLORS.maximize}
        label={maximized ? t('restore') : t('maximize')}
        onClick={() => void controls.toggleMaximize()}
      />
      <WindowButton color={BUTTON_COLORS.minimize} label={t('minimize')} onClick={() => void controls.minimize()} />
      <WindowButton color={BUTTON_COLORS.close} label={t('close')} onClick={() => void controls.close()} />
    </div>
  );
}

function WindowButton({ color, label, onClick }: { color: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ background: color }}
      className="size-3 rounded-full transition-opacity duration-150 hover:opacity-80"
    />
  );
}
