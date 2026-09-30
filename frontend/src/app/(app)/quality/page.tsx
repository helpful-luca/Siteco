import { Gauge } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/features/shell';

export default async function QualityPage() {
  const t = await getTranslations('placeholder');
  return <ComingSoon icon={<Gauge aria-hidden />} title={t('quality.title')} text={t('quality.text')} note={t('note')} />;
}
