/**
 * Shipping & pricing configuration for Storywink print orders.
 *
 * Phase 1: Singapore & Malaysia only
 * Phase 2: Will expand to US, Canada, UK, Australia, Europe, etc.
 */

import Stripe from 'stripe';

/**
 * Print retail pricing — what the customer pays (not Lulu's cost).
 */
export const PRINT_PRICING = {
  RETAIL_PRICE_CENTS: 3500, // S$35.00
  CURRENCY: 'sgd',
} as const;

export interface ShippingTier {
  key: string;
  displayName: string;
  priceCents: number;
  countries: string[];
  luluLevel: string;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
}

/**
 * Shipping tiers available for checkout.
 * Single flat rate for Phase 1 (SG/MY).
 */
export const SHIPPING_TIERS = {
  SINGAPORE_MALAYSIA: {
    key: 'sg_my',
    displayName: 'Shipping',
    priceCents: 2000, // S$20.00
    countries: ['SG', 'MY'],
    luluLevel: 'MAIL',
    deliveryDaysMin: 7,
    deliveryDaysMax: 14,
  },
} as const satisfies Record<string, ShippingTier>;

/**
 * Get all countries that are allowed for shipping.
 * Used for Stripe Checkout's shipping_address_collection.allowed_countries.
 */
export function getAllowedCountries(): string[] {
  const countries = new Set<string>();

  for (const tier of Object.values(SHIPPING_TIERS)) {
    for (const country of tier.countries) {
      countries.add(country);
    }
  }

  return Array.from(countries);
}

/**
 * Get a shipping tier by its key (e.g., 'sg_my').
 */
export function getShippingTierByKey(key: string): ShippingTier | undefined {
  for (const tier of Object.values(SHIPPING_TIERS)) {
    if (tier.key === key) {
      return tier;
    }
  }
  return undefined;
}

/**
 * Get the Lulu shipping level for a given tier key.
 * Defaults to 'MAIL' if tier not found.
 */
export function getLuluLevelByTierKey(tierKey: string): string {
  const tier = getShippingTierByKey(tierKey);
  return tier?.luluLevel || 'MAIL';
}

/**
 * Get all available shipping tiers as an array.
 */
export function getAllShippingTiers(): ShippingTier[] {
  return Object.values(SHIPPING_TIERS);
}

/**
 * Build Stripe shipping options for checkout session.
 * Returns shipping_options array for Stripe.Checkout.SessionCreateParams.
 */
export function buildStripeShippingOptions(): Array<{
  shipping_rate_data: Stripe.Checkout.SessionCreateParams.ShippingOption.ShippingRateData;
}> {
  return getAllShippingTiers().map(tier => ({
    shipping_rate_data: {
      type: 'fixed_amount' as const,
      fixed_amount: {
        amount: tier.priceCents,
        currency: PRINT_PRICING.CURRENCY,
      },
      display_name: tier.displayName,
      delivery_estimate: {
        minimum: { unit: 'business_day' as const, value: tier.deliveryDaysMin },
        maximum: { unit: 'business_day' as const, value: tier.deliveryDaysMax },
      },
      metadata: {
        tierKey: tier.key,
        luluLevel: tier.luluLevel,
      },
    },
  }));
}

/**
 * Get shipping tiers available for a specific country.
 */
export function getShippingTiersForCountry(countryCode: string): ShippingTier[] {
  return getAllShippingTiers().filter(tier =>
    tier.countries.includes(countryCode.toUpperCase())
  );
}

/**
 * Check if a country is supported for shipping.
 */
export function isCountrySupported(countryCode: string): boolean {
  return getAllowedCountries().includes(countryCode.toUpperCase());
}
