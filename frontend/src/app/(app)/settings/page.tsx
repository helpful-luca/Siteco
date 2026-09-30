import { Settings } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/features/shell';

export default async function SettingsPage() {
  const t = await getTranslations('placeholder');
  return (
    <ComingSoon icon={<Settings aria-hidden />} title={t('settings.title')} text={t('settings.text')} note={t('note')} />
  );
}
