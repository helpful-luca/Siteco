import type { Theme } from '@/shared/preferences/cookies';

const PALETTES = {
  light: { canvas: '#f2f2f5', panel: '#ffffff', line: '#d9d9de', accent: '#b61918' },
  dark: { canvas: '#000000', panel: '#1c1c1e', line: '#3a3a3e', accent: '#d63030' },
} as const;

function Window({ mode }: { mode: 'light' | 'dark' }) {
  const p = PALETTES[mode];
  return (
    <div className="flex h-full w-full gap-1 p-1.5" style={{ background: p.canvas }}>
      <div className="w-1/3 rounded-[5px]" style={{ background: p.panel }}>
        <div className="m-1.5 h-1 w-3/4 rounded-full" style={{ background: p.line }} />
        <div className="m-1.5 h-1 w-1/2 rounded-full" style={{ background: p.line }} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1 p-1">
        <div className="h-1 w-5/6 rounded-full" style={{ background: p.line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: p.line }} />
        <div className="mt-1 flex h-3 items-center justify-end rounded-full px-0.5" style={{ background: p.panel }}>
          <span className="size-2 rounded-full" style={{ background: p.accent }} />
        </div>
      </div>
    </div>
  );
}

/** Miniature app window so the choice is seen, not only named. */
export function ThemeThumbnail({ theme }: { theme: Theme }) {
  return (
    <div aria-hidden className="h-19 w-full overflow-hidden rounded-inner ring-1 ring-hairline">
      {theme === 'system' ? (
        <div className="flex h-full">
          <div className="w-1/2 overflow-hidden">
            <div className="h-full w-[200%]">
              <Window mode="light" />
            </div>
          </div>
          <div className="w-1/2 overflow-hidden">
            <div className="-ml-[100%] h-full w-[200%]">
              <Window mode="dark" />
            </div>
          </div>
        </div>
      ) : (
        <Window mode={theme} />
      )}
    </div>
  );
}
