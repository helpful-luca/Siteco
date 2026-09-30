import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('app');
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">{t('name')}</h1>
      <p className="mt-3 text-lg opacity-70">{t('greeting')}</p>
    </section>
  );
}
