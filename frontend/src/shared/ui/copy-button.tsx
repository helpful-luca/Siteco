'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './button';
import { Tooltip } from './tooltip';

type Props = {
  /** The text to copy, or a function that builds it on click. */
  text: string | (() => string);
  label: string;
  copiedLabel: string;
  size?: 'sm' | 'md';
  className?: string;
};

/** Icon button that copies text and confirms with a check mark for a moment. */
export function CopyButton({ text, label, copiedLabel, size = 'sm', className }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setCopied(true);
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing to confirm.
    }
  };

  return (
    <Tooltip content={copied ? copiedLabel : label}>
      <Button icon variant="ghost" size={size} aria-label={label} onClick={copy} className={className}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span className="sr-only" aria-live="polite">
          {copied ? copiedLabel : ''}
        </span>
      </Button>
    </Tooltip>
  );
}
