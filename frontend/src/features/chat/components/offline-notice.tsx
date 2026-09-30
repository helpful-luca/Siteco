'use client';

import { useTranslations } from 'next-intl';
import { fetchJson } from '@/shared/api/client';
import { Button } from '@/shared/ui';
import { ComposerNotice } from './composer-notice';

/** The backend is away: the question waits in the field, the app keeps checking by itself. */
export function OfflineNotice({ id }: { id: string }) {
  const t = useTranslations('chat.composer');
  const tBanner = useTranslations('banner');
  return (
    <ComposerNotice
      id={id}
      tone="info"
      action={
        <Button size="sm" variant="secondary" onClick={() => void fetchJson('/api/health/live').catch(() => undefined)}>
          {tBanner('retryNow')}
        </Button>
      }
    >
      {t('offline')}
    </ComposerNotice>
  );
}
