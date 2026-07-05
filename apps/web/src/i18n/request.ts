import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { getUserLocale, DEFAULT_LOCALE } from './locale';

// next-intl has no built-in catalog fallback: a key missing from ja.json
// would render as a raw key path. Merging the locale catalog over the
// English base makes missing keys fall back to English instead.
export function deepMergeMessages(
  base: AbstractIntlMessages,
  override: AbstractIntlMessages,
): AbstractIntlMessages {
  const merged: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof baseValue === 'object' &&
      baseValue !== null
    ) {
      merged[key] = deepMergeMessages(baseValue, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export default getRequestConfig(async () => {
  const locale = await getUserLocale();
  const enMessages = (await import('../../messages/en.json'))
    .default as AbstractIntlMessages;

  if (locale === DEFAULT_LOCALE) {
    return { locale, messages: enMessages };
  }

  let localeMessages: AbstractIntlMessages;
  try {
    localeMessages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Unknown locale cookie — serve English rather than crash the request.
    return { locale: DEFAULT_LOCALE, messages: enMessages };
  }

  return { locale, messages: deepMergeMessages(enMessages, localeMessages) };
});
