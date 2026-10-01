'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, cn, FormGroup, FormRow, TextInput } from '@/shared/ui';
import { useApiKey, useApiKeyChange, useWorkspace } from '../queries';
import { useCostFormat } from '../use-cost-format';

/**
 * The Claude key: one field to enter it (checked before it is saved), a plain remove button
 * and this app's own spending.
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
  const message = error
    ? { tone: 'text-danger', text: text.error(toApiError(error).code) }
    : save.isSuccess
      ? {
          tone: 'text-ink-muted',
          text: save.data.status === 'ok' ? t('saved') : t('savedUnchecked'),
        }
      : null;

  return (
    <>
      <div>
        <FormGroup title={t('title')} footer={t('footer')}>
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
                {t('save')}
              </Button>
            </div>
          </FormRow>
        </FormGroup>
        {key?.source === 'settings' && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="mt-2 ml-4 text-footnote text-ink-muted hover:text-ink hover:underline disabled:opacity-50"
          >
            {t('remove')}
          </button>
        )}
        <p
          aria-live="polite"
          role={error ? 'alert' : undefined}
          className={cn('px-4 pt-2 text-footnote', message?.tone)}
        >
          {message?.text ?? ''}
        </p>
      </div>

      <FormGroup title={t('spend')}>
        <FormRow label={t('today')} description={workspace && t('requests', { count: workspace.usage_today.requests })}>
          <span className="text-body text-ink-muted tabular-nums">
            {workspace ? cost(workspace.usage_today.cost_usd) : ''}
          </span>
        </FormRow>
        <FormRow label={t('month')} description={workspace && t('requests', { count: workspace.usage_month.requests })}>
          <span className="text-body text-ink-muted tabular-nums">
            {workspace ? cost(workspace.usage_month.cost_usd) : ''}
          </span>
        </FormRow>
      </FormGroup>
    </>
  );
}
