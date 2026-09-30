import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { COOKIE_LOCALE, resolveLocale } from '@/shared/preferences/cookies';

export default getRequestConfig(async () => {
  const locale = resolveLocale(
    (await cookies()).get(COOKIE_LOCALE)?.value,
    (await headers()).get('accept-language') ?? undefined,
  );
  return { locale, messages: (await import(`../../../messages/${locale}.json`)).default };
});
