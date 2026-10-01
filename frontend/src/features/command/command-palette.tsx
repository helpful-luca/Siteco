'use client';

import { Dialog } from '@base-ui/react/dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useUI } from '@/features/shell';
import { cn, Kbd } from '@/shared/ui';
import { type RankedCommand, rankCommands } from './rank';
import { useCommands } from './use-commands';

/**
 * Command+K: one glass field that finds chats, documents, actions and settings, like Raycast and
 * Spotlight. Keyboard first: the focus stays in the field (combobox with an active descendant),
 * arrow keys move, Enter runs, Escape closes. The mouse works too.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useUI();
  // Stable: the command list is memoised on it, a new function would rebuild it on every key.
  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);
  const t = useTranslations('command');
  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(open) => setPaletteOpen(open)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/15 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0 dark:bg-black/40" />
        <Dialog.Popup
          aria-label={t('label')}
          className={cn(
            'glass-dense specular fixed top-[max(14vh,calc(var(--window-top)+var(--spacing)*16))] left-1/2 z-50 flex max-h-[min(36rem,72dvh)]',
            'w-[min(40rem,calc(100vw-var(--spacing)*8))] -translate-x-1/2 flex-col rounded-panel outline-none',
            'transition-[opacity,translate,scale] duration-200 ease-out-soft',
            'data-starting-style:-translate-y-1 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            'data-ending-style:opacity-0 data-ending-style:duration-100',
          )}
        >
          {paletteOpen && <PaletteBody onClose={close} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations('command');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const commands = useCommands(onClose);
  const groups = useMemo(() => rankCommands(commands, query), [commands, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const current = flat[Math.min(active, flat.length - 1)] as RankedCommand | undefined;
  const optionId = useCallback((item: RankedCommand) => `${listId}-${item.command.id}`, [listId]);

  // The active row stays in view while the arrow keys move it.
  useEffect(() => {
    if (!current) return;
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  }, [current, optionId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const last = flat.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: active >= last ? 0 : active + 1,
      ArrowUp: active <= 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves && flat.length > 0 && !(event.key in { Home: 1, End: 1 } && query)) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      current.command.run();
    }
  };

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-5">
        <Search aria-hidden className="size-5 shrink-0 text-ink-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-title-3 font-normal tracking-normal text-ink outline-none placeholder:text-ink-muted/70"
        />
        <Kbd>esc</Kbd>
      </div>

      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={t('label')}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
      >
        {flat.length === 0 ? (
          <div className="px-3 py-10 text-center" role="status">
            <p className="text-body font-medium">{t('empty', { query: query.trim() })}</p>
            <p className="mt-1 text-footnote text-ink-muted">{t('emptyHint')}</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.group} role="group" aria-labelledby={`${listId}-${group.group}`} className="not-first:mt-2">
              <div id={`${listId}-${group.group}`} className="px-3 pt-1 pb-1.5 text-caption font-semibold text-ink-muted">
                {t(`groups.${group.group}`)}
              </div>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                const selected = item === current;
                return (
                  <div
                    key={item.command.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => index !== active && setActive(index)}
                    onClick={item.command.run}
                    className={cn(
                      'flex h-10 items-center gap-3 rounded-control px-3 text-body pointer-coarse:h-11',
                      '[&_svg]:size-4 [&_svg]:shrink-0',
                      selected ? 'bg-fill-strong text-ink [&_svg]:text-ink' : 'text-ink/90 [&_svg]:text-ink-muted',
                    )}
                  >
                    {item.command.icon}
                    <Highlighted text={item.command.title} indices={item.indices} />
                    {item.command.hint && (
                      <span className="ml-auto shrink-0 pl-3 text-footnote text-ink-muted tabular-nums">{item.command.hint}</span>
                    )}
                    {selected && (
                      <CornerDownLeft aria-hidden className={cn('text-ink-muted', !item.command.hint && 'ml-auto')} />
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-end gap-4 border-t border-hairline px-5 text-caption text-ink-muted pointer-coarse:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t('hints.move')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {t('hints.open')}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd>
          {t('hints.close')}
        </span>
      </div>
    </>
  );
}

/** The title with the matched characters in ink and medium weight, the rest a little quieter. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <span className="min-w-0 truncate">{text}</span>;
  const marked = new Set(indices);
  return (
    <span className="min-w-0 truncate">
      {[...text].map((char, index) =>
        marked.has(index) ? (
          <mark key={index} className="bg-transparent font-semibold text-ink">
            {char}
          </mark>
        ) : (
          <span key={index}>{char}</span>
        ),
      )}
    </span>
  );
}
