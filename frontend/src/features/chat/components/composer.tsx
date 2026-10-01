'use client';

import { ArrowUp, FileUp, Link2, Paperclip, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Button, cn, Menu, MenuItem, Tooltip } from '@/shared/ui';

/** The counter appears from 80 % of the limit (annex 10, E5). */
const COUNTER_FROM = 0.8;
const MAX_HEIGHT_PX = 240;

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (question: string) => void;
  onStop: () => void;
  /** Files from this computer, or a link the backend downloads (both: into this chat). */
  onAttach: () => void;
  onAttachLink?: () => void;
  /** An answer is running in this chat: the button stops it, typing a draft still works. */
  busy: boolean;
  /** The question is on its way and not yet confirmed. */
  sending: boolean;
  /** Sending is not possible right now (reason shown in the notice above). */
  blocked: boolean;
  maxChars: number | undefined;
  describedBy?: string;
  autoFocus?: boolean;
};

/**
 * Floating glass composer. Enter sends, Shift+Enter makes a new line, Escape stops a running
 * answer; Enter while an IME is composing never sends (annex 10, O6, E24).
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onAttach,
  onAttachLink,
  busy,
  sending,
  blocked,
  maxChars,
  describedBy,
  autoFocus = false,
}: Props) {
  const t = useTranslations('chat.composer');
  const tImport = useTranslations('library.import');
  const locale = useLocale();
  const field = useRef<HTMLTextAreaElement>(null);
  const length = value.trim().length;
  const tooLong = maxChars !== undefined && value.length > maxChars;
  const canSend = length > 0 && !tooLong && !busy && !sending && !blocked;
  const showCounter = maxChars !== undefined && value.length >= maxChars * COUNTER_FROM;

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const send = () => {
    if (canSend) onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  return (
    <form
      className="glass pointer-events-auto flex items-end gap-2 rounded-panel p-2"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {onAttachLink ? (
        <Menu
          side="top"
          trigger={
            <Button icon variant="ghost" aria-label={t('attach')}>
              <Paperclip />
            </Button>
          }
        >
          <MenuItem onClick={onAttach}>
            <FileUp aria-hidden />
            {tImport('files')}
          </MenuItem>
          <MenuItem onClick={onAttachLink}>
            <Link2 aria-hidden />
            {tImport('link')}
          </MenuItem>
        </Menu>
      ) : (
        <Tooltip content={t('attach')}>
          <Button icon variant="ghost" aria-label={t('attach')} onClick={onAttach}>
            <Paperclip />
          </Button>
        </Tooltip>
      )}
      <label className="sr-only" htmlFor="composer-field">
        {t('label')}
      </label>
      <textarea
        id="composer-field"
        ref={field}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={t('placeholder')}
        aria-describedby={describedBy}
        aria-invalid={tooLong || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-8 flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent py-0.5 text-reading outline-none placeholder:truncate placeholder:text-ink-muted"
      />
      {showCounter && (
        <span
          className={cn('shrink-0 self-center text-caption tabular-nums', tooLong ? 'text-danger' : 'text-ink-muted')}
          aria-live="polite"
        >
          {t('counter', {
            count: new Intl.NumberFormat(locale).format(value.length),
            max: new Intl.NumberFormat(locale).format(maxChars),
          })}
        </span>
      )}
      {/*
        One button that turns from send into stop and back, so keyboard focus never falls to the
        page. Not `disabled` (that would drop focus too): `aria-disabled` plus a guard in `send`.
      */}
      <Tooltip content={busy ? t('stop') : t('send')}>
        <Button
          icon
          variant={busy ? 'secondary' : 'primary'}
          type={busy ? 'button' : 'submit'}
          aria-label={busy ? t('stop') : t('send')}
          aria-disabled={!busy && !canSend ? true : undefined}
          onClick={busy ? onStop : undefined}
          className="aria-disabled:opacity-40 aria-disabled:hover:brightness-100 aria-disabled:active:scale-100"
        >
          {busy ? <Square className="fill-current" /> : <ArrowUp />}
        </Button>
      </Tooltip>
    </form>
  );
}
