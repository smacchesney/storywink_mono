/**
 * Where the print affordance may render at all.
 *
 * Storywink can only ship printed books to the countries in SHIPPING_TIERS
 * (SG/MY today). A locale whose families overwhelmingly live outside that
 * list (ja → JP) must never see a print CTA that dead-ends at Stripe's
 * address screen — those surfaces show the honest "printing comes soon"
 * line instead and capture interest via track('print_interest').
 *
 * The country list derives from the shared shipping config, so the day a
 * JP tier lands in SHIPPING_TIERS this gate lifts by itself.
 */
import { getAllowedCountries } from '@storywink/shared';

/**
 * The home market implied by a UI locale (the `storywink-locale` cookie
 * value). Only list locales that map to one country; locales without an
 * entry (en is global) keep the print path, and Stripe's allowed-countries
 * list stays the final gate at checkout.
 */
const LOCALE_HOME_COUNTRY: Record<string, string> = {
  ja: 'JP',
};

/** True when a print CTA may render for this UI locale. */
export function isPrintShippableLocale(locale: string): boolean {
  const homeCountry = LOCALE_HOME_COUNTRY[locale];
  if (!homeCountry) return true;
  return getAllowedCountries().includes(homeCountry);
}
