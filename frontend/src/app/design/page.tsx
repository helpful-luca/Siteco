import { cookies } from 'next/headers';
import { StyleguideView } from '@/features/styleguide';
import { COOKIE_THEME, resolveTheme } from '@/shared/preferences/cookies';

/** Living style screen. Works without the backend, so it sits outside the (app) group. */
export default async function DesignPage() {
  const theme = resolveTheme((await cookies()).get(COOKIE_THEME)?.value);
  return <StyleguideView theme={theme} />;
}
