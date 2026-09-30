'use client';

import { AlertCircle, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';

type Props = {
  id?: string;
  tone: 'info' | 'error';
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
};

/** A calm note right above the composer: preconditions and refusals before the stream (annex 10, 3.3). */
export function ComposerNotice({ id, tone, children, action, onDismiss }: Props) {
  const t = useTranslations('chat.composer');
  return (
    <div
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className="glass-dense pointer-events-auto flex items-start gap-3 rounded-card py-2 pr-2 pl-4"
    >
      {tone === 'error' ? (
        <AlertCircle aria-hidden className="mt-2 size-4 shrink-0 text-danger" />
      ) : (
        <Info aria-hidden className="mt-2 size-4 shrink-0 text-ink-muted" />
      )}
      <p className="min-w-0 flex-1 py-1.5 text-footnote">{children}</p>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <Button icon variant="ghost" size="sm" aria-label={t('dismiss')} onClick={onDismiss} className="mt-0.5">
          <X />
        </Button>
      )}
    </div>
  );
}
