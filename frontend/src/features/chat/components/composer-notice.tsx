'use client';

import { AlertCircle, Info, Timer, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';

type Props = {
  id?: string;
  /** `wait`: a countdown that announces itself, so the note carries no live role of its own. */
  tone: 'info' | 'error' | 'wait';
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
};

/** A calm note right above the composer: preconditions and refusals before the stream. */
export function ComposerNotice({ id, tone, children, action, onDismiss }: Props) {
  const t = useTranslations('chat.composer');
  return (
    <div
      id={id}
      role={tone === 'error' ? 'alert' : tone === 'info' ? 'status' : undefined}
      className="glass-dense pointer-events-auto flex items-start gap-3 rounded-card py-2 pr-2 pl-4"
    >
      {tone === 'error' ? (
        <AlertCircle aria-hidden className="mt-2 size-4 shrink-0 text-danger" />
      ) : tone === 'wait' ? (
        <Timer aria-hidden className="mt-2 size-4 shrink-0 text-ink-muted" />
      ) : (
        <Info aria-hidden className="mt-2 size-4 shrink-0 text-ink-muted" />
      )}
      <div className="min-w-0 flex-1 py-1.5 text-footnote">{children}</div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <Button icon variant="ghost" size="sm" aria-label={t('dismiss')} onClick={onDismiss} className="mt-0.5">
          <X />
        </Button>
      )}
    </div>
  );
}
