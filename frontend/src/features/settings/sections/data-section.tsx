'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatSize } from '@/features/library';
import { useUI } from '@/features/shell';
import { ApiError, toApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { usePreferences } from '@/shared/preferences/preferences';
import { Button, DelayedSpinner, FormGroup, FormRow, SegmentedControl } from '@/shared/ui';
import { DeleteAllDialog } from '../delete-all-dialog';
import { downloadExport, useDeleteEverything, useWorkspace, WORKSPACE_KEY } from '../queries';
import { useCostFormat } from '../use-cost-format';
import { SaveError, useSettingSave } from '../use-setting-save';

/** What the app offers; a different installation default (RETENTION_DAYS) is shown as well. */
const RETENTION_CHOICES = [0, 30, 90, 365];

function useFormat() {
  const format = useFormatter();
  const size = useFormatSize();
  const cost = useCostFormat();
  return { size, count: (value: number) => format.number(value), cost };
}

export function DataSection() {
  const t = useTranslations('settings.data');
  const text = useCodeText();
  const format = useFormat();
  const { closePanel } = useUI();
  const queryClient = useQueryClient();
  const { stored } = usePreferences();
  const retentionSave = useSettingSave();
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

  const { stats, usage_today: today } = data;
  const retention = stored?.retention_days ?? data.retention_days ?? 0;
  const choices = RETENTION_CHOICES.includes(retention)
    ? RETENTION_CHOICES
    : [...RETENTION_CHOICES, retention].sort((a, b) => a - b);
  const chooseRetention = async (value: string) => {
    if (await retentionSave.save({ retention_days: Number(value) })) {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_KEY });
    }
  };
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

      {/* Spending is in Models; here only next to a daily budget set for this installation. */}
      {today.budget_usd !== null && (
        <FormGroup title={t('today')}>
          <FormRow label={t('cost')} description={t('requests', { count: today.requests })}>
            <span className="text-body text-ink-muted tabular-nums">{format.cost(today.cost_usd)}</span>
          </FormRow>
          <FormRow label={t('budget')}>
            <span className="text-body text-ink-muted tabular-nums">{format.cost(today.budget_usd)}</span>
          </FormRow>
        </FormGroup>
      )}

      <div>
        <FormGroup title={t('retention')}>
          <FormRow stretch label={t('retentionChoice')}>
            <SegmentedControl
              className="w-full sm:w-auto [&>*]:min-w-0 [&>*]:flex-1 sm:[&>*]:min-w-16 sm:[&>*]:flex-none"
              label={t('retention')}
              value={String(retention)}
              onValueChange={(value) => void chooseRetention(value)}
              options={choices.map((days) => ({
                value: String(days),
                label: t('retentionOption', { days }),
              }))}
            />
          </FormRow>
        </FormGroup>
        <SaveError error={retentionSave.error} />
      </div>

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
