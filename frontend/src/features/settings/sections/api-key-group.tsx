'use client';

import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, buttonStyles, cn, FormGroup, FormRow, TextInput } from '@/shared/ui';
import { useApiKey, useApiKeyChange, useWorkspace } from '../queries';
import { useCostFormat } from '../use-cost-format';

// Anthropic offers no API for the credit left on a key: the Console is the only honest source.
const CONSOLE_BILLING_URL = 'https://console.anthropic.com/settings/billing';

const STATUS_TONE = { ok: 'text-success', unchecked: 'text-ink-muted', missing_key: 'text-ink-muted', invalid_key: 'text-danger' };

/**
 * The Claude key: where it comes from, its last characters and whether Anthropic accepts it,
 * a field to enter a new one (checked before it is saved) and this app's own spending.
 */
export function ApiKeyGroup() {
  const t = useTranslations('settings.apiKey');
  const text = useCodeText();
  const cost = useCostFormat();
  const fieldId = useId();
  const { data: key } = useApiKey();
  const { data: workspace } = useWorkspace();
  const { save, remove } = useApiKeyChange();
  const [draft, setDraft] = useState('');

  // No <form> around the row: it would break the grouped list's separators.
  const submit = () => {
    if (!draft.trim() || save.isPending) return;
    remove.reset();
    save.mutate(draft, { onSuccess: () => setDraft('') });
  };

  const error = save.error ?? remove.error;
  const source = key?.source === 'settings' ? t('fromSettings') : key?.source === 'env' ? t('fromEnv') : null;
  const message = error
    ? { tone: 'text-danger', text: text.error(toApiError(error).code) }
    : save.isSuccess
      ? { tone: 'text-ink-muted', text: save.data.status === 'ok' ? t('saved') : t('savedUnchecked') }
      : null;

  return (
    <>
      <div>
        <FormGroup title={t('title')} footer={t('footer')}>
          <FormRow
            label={t('current')}
            description={key?.suffix ? `${t('endsWith', { suffix: key.suffix })}, ${source}` : t('none')}
          >
            {key && (
              <span className={cn('text-body', STATUS_TONE[key.status])}>{t(`status.${key.status}`)}</span>
            )}
          </FormRow>
          <FormRow stretch label={t('label')} htmlFor={fieldId}>
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
                <TextInput
                  id={fieldId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('placeholder')}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                  }}
                  className="w-full min-w-0 sm:w-56"
                />
                <Button disabled={!draft.trim() || save.isPending} onClick={submit}>
                  {save.isPending ? t('checking') : t('save')}
                </Button>
              </div>
            </FormRow>
          {key?.source === 'settings' && (
            <FormRow label={t('remove')} description={t('removeText')}>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t('remove')}
              </Button>
            </FormRow>
          )}
        </FormGroup>
        <p aria-live="polite" role={error ? 'alert' : undefined} className={cn('px-4 pt-2 text-footnote', message?.tone)}>
          {message?.text ?? ''}
        </p>
      </div>

      <FormGroup title={t('spend')} footer={t('spendFooter')}>
        <FormRow label={t('today')} description={workspace && t('requests', { count: workspace.usage_today.requests })}>
          <span className="text-body text-ink-muted tabular-nums">{workspace ? cost(workspace.usage_today.cost_usd) : ''}</span>
        </FormRow>
        <FormRow label={t('month')} description={workspace && t('requests', { count: workspace.usage_month.requests })}>
          <span className="text-body text-ink-muted tabular-nums">{workspace ? cost(workspace.usage_month.cost_usd) : ''}</span>
        </FormRow>
        <FormRow label={t('console')} description={t('consoleText')}>
          <a href={CONSOLE_BILLING_URL} target="_blank" rel="noopener noreferrer" className={buttonStyles()}>
            {t('consoleOpen')}
            <ExternalLink aria-hidden />
          </a>
        </FormRow>
      </FormGroup>
    </>
  );
}
