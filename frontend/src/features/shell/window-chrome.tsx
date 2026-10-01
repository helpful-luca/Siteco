'use client';

import { Ellipsis } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { useDesktop } from '@/shared/desktop/use-desktop';
import { cn } from '@/shared/ui';

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

/** Caption glyphs in the Windows 11 style: 10 px, one hairline. */
const GLYPHS = {
  minimize: <path d="M0 5.5h10" />,
  maximize: <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />,
  restore: (
    <>
      <rect x="0.5" y="2.5" width="7" height="7" rx="1.25" />
      <path d="M2.5 2.5V2a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 9.5 2v4A1.5 1.5 0 0 1 8 7.5h-.5" />
    </>
  ),
  close: <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />,
} as const;

function CaptionButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-11.5 items-center justify-center text-ink transition-colors duration-150 ease-out-soft',
        'focus-visible:-outline-offset-2',
        danger
          ? 'hover:bg-caption-close hover:text-white active:bg-caption-close/85'
          : 'hover:bg-fill-strong active:bg-fill',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Window buttons for Windows, where the window has no system title bar: the app menu,
 * minimize, maximize or restore, close. Top right in the title bar, like every Windows app.
 * macOS keeps its native traffic lights, so nothing is drawn there (or in a browser).
 */
export function WindowControls() {
  const t = useTranslations('shell.window');
  const desktop = useDesktop();
  const controls = desktop?.platform === 'win32' ? desktop.window : undefined;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    let active = true;
    void controls.isMaximized().then((value) => active && setMaximized(value));
    const stop = controls.onMaximizedChange(setMaximized);
    return () => {
      active = false;
      stop();
    };
  }, [controls]);

  if (!controls) return null;
  const glyph = (name: keyof typeof GLYPHS) => (
    <svg aria-hidden viewBox="0 0 10 10" className="size-2.5 overflow-visible fill-none stroke-current" strokeWidth={1}>
      {GLYPHS[name]}
    </svg>
  );
  return (
    <div data-no-drag="" className="window-controls fixed top-0 right-0 z-100 flex">
      <CaptionButton label={t('menu')} onClick={() => void controls.openMenu()}>
        <Ellipsis aria-hidden className="size-4" strokeWidth={1.75} />
      </CaptionButton>
      <CaptionButton label={t('minimize')} onClick={() => void controls.minimize()}>
        {glyph('minimize')}
      </CaptionButton>
      <CaptionButton
        label={maximized ? t('restore') : t('maximize')}
        onClick={() => void controls.toggleMaximize().then(setMaximized)}
      >
        {glyph(maximized ? 'restore' : 'maximize')}
      </CaptionButton>
      <CaptionButton label={t('close')} danger onClick={() => void controls.close()}>
        {glyph('close')}
      </CaptionButton>
    </div>
  );
}
