'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useSyncExternalStore } from 'react';
import { isApplePlatform } from '@/shared/lib/shortcut';
import { FormGroup, FormRow, Kbd } from '@/shared/ui';

/** Names of keys that differ by language (Windows labels; a Mac shows symbols). */
type KeyName = 'ctrl' | 'enter' | 'shift' | 'esc' | 'home' | 'end' | 'delete';
/** One keycap: a literal, or a key that has a Mac symbol and a localised name elsewhere. */
type Key = string | { mac: string; name: KeyName };
/** `combos` on a Mac and elsewhere; `otherCombos` where Windows and Linux use different keys. */
type Shortcut = { id: string; combos: Key[][]; otherCombos?: Key[][] };

const MOD: Key = { mac: '⌘', name: 'ctrl' };
const SHIFT: Key = { mac: '⇧', name: 'shift' };
const ENTER: Key = { mac: '↩', name: 'enter' };
const ESC: Key = { mac: 'esc', name: 'esc' };

/**
 * Every shortcut the app handles, grouped like the places they work in. Keep in sync with
 * shell/app-shell.tsx (palette, sidebar), chat/components/composer.tsx, chat/components/chat-list.tsx,
 * command/command-palette.tsx and shell/right-panel.tsx.
 */
const GROUPS: { id: 'general' | 'chat' | 'list' | 'palette'; shortcuts: Shortcut[] }[] = [
  {
    id: 'general',
    shortcuts: [
      { id: 'palette', combos: [[MOD, 'K']] },
      { id: 'sidebar', combos: [[SHIFT, MOD, 'S'], [MOD, '\\']] },
      { id: 'closePanel', combos: [[ESC]] },
    ],
  },
  {
    id: 'chat',
    shortcuts: [
      { id: 'send', combos: [[ENTER]] },
      { id: 'newline', combos: [[SHIFT, ENTER]] },
      { id: 'stop', combos: [[ESC]] },
    ],
  },
  {
    id: 'list',
    shortcuts: [
      { id: 'move', combos: [['↑'], ['↓']] },
      { id: 'ends', combos: [[{ mac: 'fn ←', name: 'home' }], [{ mac: 'fn →', name: 'end' }]] },
      { id: 'rename', combos: [['F2']] },
      // A Mac laptop has no forward delete: Command plus Backspace does the same.
      { id: 'delete', combos: [['⌘', '⌫']], otherCombos: [[{ mac: '⌦', name: 'delete' }]] },
    ],
  },
  {
    id: 'palette',
    shortcuts: [
      { id: 'choose', combos: [['↑'], ['↓']] },
      { id: 'open', combos: [[ENTER]] },
      { id: 'close', combos: [[ESC]] },
    ],
  },
];

const noSubscription = () => () => undefined;

/** A list of the keyboard shortcuts, with Mac symbols on Apple devices and key names elsewhere. */
export function ShortcutsSection() {
  const t = useTranslations('settings.shortcuts');
  // The server renders the Mac labels; a Windows or Linux browser switches after hydration.
  const apple = useSyncExternalStore(noSubscription, isApplePlatform, () => true);

  const label = (key: Key) => (typeof key === 'string' ? key : apple ? key.mac : t(`keys.${key.name}`));
  const combos = (shortcut: Shortcut) =>
    (apple ? shortcut.combos : (shortcut.otherCombos ?? shortcut.combos)).map((combo) => combo.map(label));

  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => (
        <FormGroup key={group.id} title={t(`groups.${group.id}`)} footer={group.id === 'list' ? t('listFooter') : undefined}>
          {group.shortcuts.map((shortcut) => (
            <FormRow key={shortcut.id} label={t(`actions.${shortcut.id}`)}>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {combos(shortcut).map((keys, i) => (
                  <Fragment key={keys.join('+')}>
                    {i > 0 && <span className="text-footnote text-ink-muted">{t('or')}</span>}
                    <span className="flex items-center gap-1">
                      {keys.map((key) => (
                        <Kbd key={key} className="min-w-6 text-footnote text-ink">
                          {key}
                        </Kbd>
                      ))}
                    </span>
                  </Fragment>
                ))}
              </span>
            </FormRow>
          ))}
        </FormGroup>
      ))}
    </div>
  );
}
