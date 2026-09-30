'use client';

import { cn } from './cn';
import { CopyButton } from './copy-button';

type Props = {
  id: string;
  /** "Fehler-ID req_1a2b3c4d": the visible label with the id in it. */
  label: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
};

/** The request id of a failure, small and copyable, for finding it in the logs. */
export function ErrorId({ id, label, copyLabel, copiedLabel, className }: Props) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-caption text-ink-muted', className)}>
      <span className="select-all">{label}</span>
      <CopyButton text={id} label={copyLabel} copiedLabel={copiedLabel} />
    </span>
  );
}
