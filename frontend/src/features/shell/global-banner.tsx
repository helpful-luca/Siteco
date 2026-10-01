'use client';

import { CreditCard, Gauge, KeyRound, WifiOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useBillingBlocked } from '@/shared/api/account-status';
import { fetchJson } from '@/shared/api/client';
import { useConfig } from '@/shared/api/use-config';
import { useBackendDown } from '@/shared/api/use-connection';
import { codeParams } from '@/shared/i18n/code-params';
import { useOnline } from '@/shared/lib/use-online';
import { Button, buttonStyles, cn, Spinner } from '@/shared/ui';

/** `hint` says what to do; a banner with an action button needs none (the button says it). */
type Banner = { key: string; icon: ReactNode; title: string; hint?: string; live?: boolean; action?: ReactNode };

const ICON = 'mt-px size-4 shrink-0';
const KEY_SETTINGS_HREF = '/settings?section=models';

/** The key of the reconnecting banner, for views that show the outage where you act instead. */
export const RECONNECTING_BANNER = 'reconnecting';
/** The banners about the Claude key, for the place where the key is entered (it says it there). */
export const KEY_BANNERS = ['invalidKey', 'missingKey', 'needsWorkspace'] as const;

/**
 * One calm banner for a state of the whole app (annex 10, 3.3: banner, not toast), the most
 * important first: the backend is away, the browser is offline, the key was rejected or is
 * missing, the daily budget is used up, the Claude account hit its credit limit.
 */
export function GlobalBanner({ className, omit = [] }: { className?: string; omit?: readonly string[] }) {
  const t = useTranslations('banner');
  const locale = useLocale();
  const { data: config } = useConfig();
  const down = useBackendDown();
  const online = useOnline();
  const billing = useBillingBlocked();

  const banners: Banner[] = [];
  if (down) {
    banners.push({
      key: RECONNECTING_BANNER,
      icon: <Spinner className={ICON} />, // the title says it; no second announcement
      title: t('reconnecting'),
      hint: t('reconnectingHint'),
      live: true,
      action: (
        <Button size="sm" variant="secondary" onClick={() => void fetchJson('/api/health/live').catch(() => undefined)}>
          {t('retryNow')}
        </Button>
      ),
    });
  }
  if (!online) {
    banners.push({ key: 'offline', icon: <WifiOff aria-hidden className={cn(ICON, 'text-ink-muted')} />, title: t('offline'), hint: t('offlineHint'), live: true });
  }
  // The key is entered in Settings > Models (no restart needed).
  const keyAction = (
    <Link href={KEY_SETTINGS_HREF} className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
      {t('keySettings')}
    </Link>
  );
  if (config?.llm_status === 'invalid_key') {
    banners.push({ key: 'invalidKey', icon: <KeyRound aria-hidden className={cn(ICON, 'text-ink-muted')} />, title: t('invalidKey'), live: true, action: keyAction });
  }
  if (config?.llm_status === 'needs_workspace') {
    banners.push({
      key: 'needsWorkspace',
      icon: <KeyRound aria-hidden className={cn(ICON, 'text-ink-muted')} />,
      title: t('needsWorkspace'),
      live: true,
      action: (
        <Link href={KEY_SETTINGS_HREF} className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
          {t('workspaceSettings')}
        </Link>
      ),
    });
  }
  if (config?.llm_status === 'missing_key') {
    banners.push({ key: 'missingKey', icon: <KeyRound aria-hidden className={cn(ICON, 'text-ink-muted')} />, title: t('missingKey'), action: keyAction });
  }
  if (config?.budget?.exceeded) {
    const { time } = codeParams({ reset_time: config.budget.reset_time }, { locale });
    banners.push({ key: 'budget', icon: <Gauge aria-hidden className={cn(ICON, 'text-ink-muted')} />, title: t('budget'), hint: t('budgetHint', { time }), live: true });
  }
  if (billing) {
    banners.push({ key: 'billing', icon: <CreditCard aria-hidden className={cn(ICON, 'text-ink-muted')} />, title: t('billing'), hint: t('billingHint'), live: true });
  }

  const banner = banners.find((b) => !omit.includes(b.key));
  if (!banner) return null;
  return (
    <div
      role={banner.live ? 'status' : 'note'}
      data-banner={banner.key}
      className={cn('@container rounded-card bg-fill px-4 py-3 ring-1 ring-inset ring-hairline', className)}
    >
      {/* The action sits on the right when there is room, below the text (on its edge) when not. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 @lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        {banner.icon}
        <div className="text-footnote">
          <p className="font-medium">{banner.title}</p>
          {banner.hint && <p className="mt-0.5 text-ink-muted">{banner.hint}</p>}
        </div>
        {banner.action && (
          <div className="col-start-2 @lg:col-start-3 @lg:row-start-1 @lg:-my-1 @lg:self-center">{banner.action}</div>
        )}
      </div>
    </div>
  );
}
