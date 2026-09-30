'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFormatSize } from '@/features/library';
import { useUI } from '@/features/shell';
import { ApiError, toApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, DelayedSpinner, FormGroup, FormRow } from '@/shared/ui';
import { DeleteAllDialog } from '../delete-all-dialog';
import { downloadExport, useDeleteEverything, useWorkspace } from '../queries';

function useFormat() {
  const format = useFormatter();
  const size = useFormatSize();
  return {
    size,
    count: (value: number) => format.number(value),
    cost: (usd: number) =>
      format.number(usd, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 2,
      }),
  };
}

export function DataSection() {
  const t = useTranslations('settings.data');
  const text = useCodeText();
  const format = useFormat();
  const { closePanel } = useUI();
  const workspace = useWorkspace();
  const wipe = useDeleteEverything();
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const data = workspace.data;

  const runExport = async () => {
    setError(null);
    setExporting(true);
    try {
      await downloadExport();
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = (resetPreferences: boolean) => {
    setError(null);
    setDone(false);
    wipe.mutate(resetPreferences, {
      onSuccess: () => {
        closePanel(); // it may show a source that no longer exists
        setDone(true);
      },
      onError: (caught) => setError(toApiError(caught)),
      onSettled: () => setConfirming(false),
    });
  };

  if (!data) {
    return workspace.error ? (
      <p role="alert" className="text-body">
        {text.error(toApiError(workspace.error).code)}
      </p>
    ) : (
      <div className="grid place-items-center py-16">
        <DelayedSpinner label={t('loading')} className="size-5" />
      </div>
    );
  }

  const { stats, usage_today: today, retention_days: retention } = data;
  return (
    <div className="flex flex-col gap-8">
      <FormGroup title={t('storage')}>
        <FormRow label={t('used')} description={t('usedHint')}>
          <span className="text-body text-ink-muted tabular-nums">{format.size(stats.storage_bytes)}</span>
        </FormRow>
        <FormRow label={t('documents')}>
          <span className="text-body text-ink-muted tabular-nums">{format.count(stats.documents)}</span>
        </FormRow>
        <FormRow label={t('chats')}>
          <span className="text-body text-ink-muted tabular-nums">{format.count(stats.chats)}</span>
        </FormRow>
      </FormGroup>

      <FormGroup title={t('today')} footer={t('todayFooter')}>
        <FormRow label={t('cost')} description={t('requests', { count: today.requests })}>
          <span className="text-body text-ink-muted tabular-nums">{format.cost(today.cost_usd)}</span>
        </FormRow>
        {today.budget_usd !== null && (
          <FormRow label={t('budget')}>
            <span className="text-body text-ink-muted tabular-nums">{format.cost(today.budget_usd)}</span>
          </FormRow>
        )}
      </FormGroup>

      <FormGroup title={t('retention')} footer={t('retentionFooter')}>
        <FormRow label={t('retentionLabel')}>
          <span className="text-body text-ink-muted">
            {retention === null ? t('retentionOff') : t('retentionDays', { days: retention })}
          </span>
        </FormRow>
      </FormGroup>

      <div>
        <FormGroup title={t('yours')}>
          <FormRow label={t('export')} description={t('exportText')}>
            <Button onClick={() => void runExport()} disabled={exporting}>
              {exporting ? t('exporting') : t('exportAction')}
            </Button>
          </FormRow>
          <FormRow label={t('deleteAll')} description={t('deleteAllText')}>
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={wipe.isPending}>
              {t('deleteAllAction')}
            </Button>
          </FormRow>
        </FormGroup>
        <div aria-live="polite" className="px-4 pt-2 text-footnote">
          {error ? (
            <span role="alert" className="text-danger">
              {text.error(error.code, error.params)}
            </span>
          ) : done ? (
            <span className="text-ink-muted">{t('deleted')}</span>
          ) : null}
        </div>
      </div>

      <DeleteAllDialog
        open={confirming}
        counts={stats}
        busy={wipe.isPending}
        onConfirm={confirmDelete}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
