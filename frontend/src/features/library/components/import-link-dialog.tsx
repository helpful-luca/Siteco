'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Dialog, DialogClose, TextInput } from '@/shared/ui';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the link; the backend checks it again (and every address it leads to). */
  onImport: (url: string) => void;
};

const WEB_LINK = /^https?:\/\/\S+$/i;

/** One field for a link to a PDF, a web page or a text file. Enter imports. */
export function ImportLinkDialog({ open, onOpenChange, onImport }: Props) {
  const t = useTranslations('library.import');
  const fieldId = useId();
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setUrl('');
      setInvalid(false);
    }
    onOpenChange(next);
  };

  const submit = () => {
    const link = url.trim();
    if (!WEB_LINK.test(link)) {
      setInvalid(true);
      return;
    }
    onImport(link);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close} title={t('title')} description={t('text')}>
      <label htmlFor={fieldId} className="block text-footnote font-medium text-ink-muted">
        {t('label')}
      </label>
      <TextInput
        id={fieldId}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        placeholder={t('placeholder')}
        value={url}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${fieldId}-error` : undefined}
        onChange={(event) => {
          setUrl(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        className="mt-1.5 w-full"
      />
      <p id={`${fieldId}-error`} role={invalid ? 'alert' : undefined} className="mt-2 min-h-5 text-footnote text-danger">
        {invalid ? t('invalid') : ''}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <DialogClose render={<Button>{t('cancel')}</Button>} />
        <Button variant="primary" onClick={submit} disabled={!url.trim()}>
          {t('action')}
        </Button>
      </div>
    </Dialog>
  );
}
