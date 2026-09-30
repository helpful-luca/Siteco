'use client';

import { CloudOff, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button, buttonStyles, cn, ErrorId } from '@/shared/ui';
import { Page } from './page';

type Props = {
  /** Next.js error digest: the id that matches the server log. */
  digest?: string;
  onRetry: () => void;
  /** Inside the app shell (a page column) or on its own (the shell itself failed). */
  framed?: boolean;
};

/**
 * The calm screen of a route error boundary: what happened, that nothing is lost, and the way
 * back. No stack traces, no raw messages; the error id is there for the logs.
 */
export function ErrorScreen({ digest, onRetry, framed = true }: Props) {
  const t = useTranslations('errorScreen');
  const tAnswer = useTranslations('chat.answer');
  const body = (
    <div role="alert" className="flex max-w-[60ch] flex-col items-start">
      <div className="grid size-12 place-items-center rounded-card bg-fill text-ink-muted ring-1 ring-inset ring-hairline">
        <CloudOff aria-hidden className="size-6" />
      </div>
      <h1 className="mt-4 text-title-2 font-semibold">{t('title')}</h1>
      <p className="mt-2 text-reading text-ink-muted">{t('text')}</p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onRetry}>
          <RotateCcw aria-hidden />
          {t('retry')}
        </Button>
        <Link href="/chat" className={buttonStyles({ variant: 'ghost' })}>
          {t('home')}
        </Link>
      </div>
      {digest && (
        <ErrorId
          id={digest}
          label={tAnswer('errorId', { id: digest })}
          copyLabel={tAnswer('copyErrorId')}
          copiedLabel={tAnswer('copied')}
          className="mt-4"
        />
      )}
    </div>
  );
  if (framed) return <Page width="reading" center>{body}</Page>;
  return (
    <main className={cn('flex min-h-dvh flex-col px-gutter')}>
      <div aria-hidden className="min-h-12 flex-2" />
      <div className="mx-auto w-full max-w-reading">{body}</div>
      <div aria-hidden className="min-h-12 flex-3" />
    </main>
  );
}
