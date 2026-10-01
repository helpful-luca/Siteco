'use client';

import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { toApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, cn, FormGroup, FormRow, TextInput } from '@/shared/ui';
import { useApiKey, useApiKeyChange, useWorkspace } from '../queries';
import { useCostFormat } from '../use-cost-format';

/**
 * The Claude key: one field to enter it (checked before it is saved), an optional workspace id
 * for keys that need one, a plain remove button and this app's own spending.
 */
export function ApiKeyGroup() {
  const t = useTranslations('settings.apiKey');
  const text = useCodeText();
  const cost = useCostFormat();
  const fieldId = useId();
  const workspaceFieldId = useId();
  const workspaceField = useRef<HTMLInputElement>(null);
  const { data: key } = useApiKey();
  const { data: workspace } = useWorkspace();
  const { save, remove } = useApiKeyChange();
  const [draft, setDraft] = useState('');
  // Untouched, the field shows the stored id (not a secret); typing takes over.
  const [workspaceDraft, setWorkspaceDraft] = useState<string | null>(null);
  const workspaceId = workspaceDraft ?? key?.workspace_id ?? '';

  // No <form> around the rows: it would break the grouped list's separators.
  const submit = () => {
    if (!draft.trim() || save.isPending) return;
    remove.reset();
    save.mutate(
      { key: draft.trim(), workspaceId: workspaceId.trim() },
      {
        onSuccess: () => {
          setDraft('');
          setWorkspaceDraft(null);
        },
        onError: (caught) => {
          if (toApiError(caught).code === 'LLM_KEY_NEEDS_WORKSPACE') workspaceField.current?.focus();
        },
      },
    );
  };
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submit();
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
        <FormGroup title={t('title')}>
          <FormRow stretch label={t('label')} htmlFor={fieldId}>
            <TextInput
              id={fieldId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('placeholder')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEnter}
              className="w-full min-w-0 sm:w-72"
            />
          </FormRow>
          <FormRow stretch label={t('workspace')} description={t('workspaceHint')} htmlFor={workspaceFieldId}>
            <TextInput
              ref={workspaceField}
              id={workspaceFieldId}
              aria-describedby={`${workspaceFieldId}-description`}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('workspacePlaceholder')}
              value={workspaceId}
              onChange={(event) => setWorkspaceDraft(event.target.value)}
              onKeyDown={onEnter}
              className="w-full min-w-0 sm:w-72"
            />
          </FormRow>
        </FormGroup>
        {/* Fine print and status on the left; the buttons end on the fields' right edge. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-2">
          <div className="min-w-0 flex-1 basis-60 text-footnote">
            <p className="text-ink-muted">{t('footer')}</p>
            <p aria-live="polite" role={error ? 'alert' : undefined} className={cn('mt-1', message?.tone)}>
              {message?.text ?? ''}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {key?.source === 'settings' && (
              <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t('remove')}
              </Button>
            )}
            <Button disabled={!draft.trim() || save.isPending} onClick={submit}>
              {t('save')}
            </Button>
          </div>
        </div>
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
