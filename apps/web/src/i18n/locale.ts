import { cookies } from 'next/headers';

export const LOCALE_COOKIE = 'storywink-locale';
export const DEFAULT_LOCALE = 'en';

export async function getUserLocale(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get(LOCALE_COOKIE)?.value || DEFAULT_LOCALE;
}

export async function setUserLocale(locale: string) {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
