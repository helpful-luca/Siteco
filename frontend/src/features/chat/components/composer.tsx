'use client';

import { ArrowUp, FileUp, Link2, Paperclip, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Button, cn, Menu, MenuItem, Tooltip } from '@/shared/ui';

/** The counter appears from 80 % of the limit (annex 10, E5). */
const COUNTER_FROM = 0.8;
const MAX_HEIGHT_PX = 320;

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
  /** Controls on the bottom row after the attach button (the document scope). */
  tools?: ReactNode;
  /** Controls on the bottom row before the send button (the model choice). */
  models?: ReactNode;
};

/**
 * The floating glass composer, the hero of the chat: the question on top, a row below with attach
 * and the document scope on the left, the model and the send button on the right (like Claude and
 * ChatGPT). Enter sends, Shift+Enter makes a new line, Escape stops a running answer; Enter while
 * an IME is composing never sends (annex 10, O6, E24). Clicking the empty glass focuses the field.
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
  tools,
  models,
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

  const attach = onAttachLink ? (
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
  );

  return (
    <form
      className={cn(
        'glass glass-tight specular pointer-events-auto flex cursor-text flex-col gap-1 rounded-panel p-2',
        'transition-[border-color] duration-200 focus-within:border-hairline-strong',
      )}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onMouseDown={(event) => {
        // A click on the glass itself (not a control) puts the caret in the field.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          field.current?.focus();
        }
      }}
    >
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
        className="min-h-10 w-full resize-none overflow-y-auto overscroll-contain bg-transparent px-2 pt-1.5 text-reading outline-none placeholder:truncate placeholder:text-ink-muted"
      />
      <div className="flex min-w-0 items-center gap-1">
        {attach}
        {tools}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {showCounter && (
            <span
              className={cn('shrink-0 px-1 text-caption tabular-nums', tooLong ? 'text-danger' : 'text-ink-muted')}
              aria-live="polite"
            >
              {t('counter', {
                count: new Intl.NumberFormat(locale).format(value.length),
                max: new Intl.NumberFormat(locale).format(maxChars),
              })}
            </span>
          )}
          {models}
          {/*
            One button that turns from send into stop and back (the arrow folds into the square),
            so keyboard focus never falls to the page. Not `disabled` (that would drop focus too):
            `aria-disabled` plus a guard in `send`.
          */}
          <Tooltip content={busy ? t('stop') : t('send')}>
            <Button
              icon
              variant={busy ? 'secondary' : 'primary'}
              type={busy ? 'button' : 'submit'}
              aria-label={busy ? t('stop') : t('send')}
              aria-disabled={!busy && !canSend ? true : undefined}
              onClick={busy ? onStop : undefined}
              className="ml-1"
            >
              <span aria-hidden className="relative grid size-4 place-items-center">
                <ArrowUp
                  className={cn(
                    'absolute transition-[opacity,scale] duration-200 ease-out-soft',
                    busy ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
                  )}
                />
                <Square
                  className={cn(
                    'absolute fill-current transition-[opacity,scale] duration-200 ease-out-soft',
                    busy ? 'scale-75 opacity-100' : 'scale-50 opacity-0',
                  )}
                />
              </span>
            </Button>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
