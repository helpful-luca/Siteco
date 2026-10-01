'use client';

import { ChevronDown, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDocuments } from '@/features/library';
import { FileLabel, Menu, MenuCheckboxItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, ToolbarButton } from '@/shared/ui';

export type ScopeValue = { scope: 'all' } | { scope: 'selected'; documentIds: string[] };

type Props = { value: ScopeValue; onChange: (value: ScopeValue) => void; disabled?: boolean };

/** Which documents a chat asks: all ready ones, or a selection (master spec 6.2). */
export function ScopePicker({ value, onChange, disabled = false }: Props) {
  const t = useTranslations('chat.scope');
  const { data } = useDocuments();
  const ready = (data?.documents ?? []).filter((d) => d.status === 'ready');
  const selected = value.scope === 'selected' ? value.documentIds : [];
  const known = selected.filter((id) => data?.documents.some((d) => d.id === id) ?? true);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selected, id] : selected.filter((other) => other !== id);
    onChange(next.length > 0 ? { scope: 'selected', documentIds: next } : { scope: 'all' });
  };

  return (
    <Menu
      align="end"
      className="max-h-[min(24rem,60dvh)] w-72 overflow-y-auto overscroll-contain"
      trigger={
        <ToolbarButton disabled={disabled} aria-label={t('label')}>
          <FileText aria-hidden />
          <span className="truncate">{value.scope === 'all' ? t('all') : t('count', { count: known.length })}</span>
          <ChevronDown aria-hidden className="opacity-60" />
        </ToolbarButton>
      }
    >
      <MenuRadioGroup value={value.scope} onValueChange={() => onChange({ scope: 'all' })}>
        <MenuRadioItem value="all">{t('all')}</MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuLabel>{t('label')}</MenuLabel>
      {ready.length === 0 ? (
        <p className="px-2 py-1 text-footnote text-ink-muted">{t('none')}</p>
      ) : (
        ready.map((document) => (
          <MenuCheckboxItem
            key={document.id}
            checked={selected.includes(document.id)}
            onCheckedChange={(checked) => toggle(document.id, checked)}
          >
            <FileLabel name={document.filename} />
          </MenuCheckboxItem>
        ))
      )}
    </Menu>
  );
}
