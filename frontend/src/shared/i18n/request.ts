import { getRequestConfig } from 'next-intl/server';
import { getInitialPreferences } from '@/shared/preferences/server';

export default getRequestConfig(async () => {
  const { locale } = await getInitialPreferences();
  return { locale, messages: (await import(`../../../messages/${locale}.json`)).default };
});
