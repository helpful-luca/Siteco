'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUploads } from '@/features/library';

/**
 * Start of a new chat: a left-aligned greeting and one drop target (design plan: no card trio).
 * The composer arrives with the chat itself (phase 4). The name comes from the preferences later.
 */
export function NewChatView() {
  const t = useTranslations('chat');
  const { openPicker } = useUploads();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-4 py-12 sm:px-8">
      <h1 className="text-title-1 font-semibold">{t('greeting')}</h1>
      <p className="mt-2 text-reading text-ink-muted">{t('prompt')}</p>
      <button
        type="button"
        onClick={openPicker}
        className="group mt-10 flex w-full items-center gap-4 rounded-card border border-dashed border-hairline-strong px-5 py-5 text-left transition-colors hover:border-sodium/70 hover:bg-fill"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-highlight text-sodium-ink">
          <FileUp aria-hidden className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-body font-medium">{t('dropTitle')}</span>
          <span className="mt-0.5 block text-footnote text-ink-muted">{t('dropText')}</span>
        </span>
      </button>
      <p className="mt-4 max-w-[60ch] text-footnote text-ink-muted">{t('hint')}</p>
    </div>
  );
}
