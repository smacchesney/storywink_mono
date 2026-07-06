import { describe, expect, it } from 'vitest';
import { getAllowedCountries } from '@storywink/shared';
import { isPrintShippableLocale } from './print-availability';

describe('isPrintShippableLocale', () => {
  it('hides print for ja while no shipping tier covers JP', () => {
    // Guard the premise: today's tiers are SG/MY only.
    expect(getAllowedCountries()).not.toContain('JP');
    expect(isPrintShippableLocale('ja')).toBe(false);
  });

  it('keeps print for the global default locale', () => {
    expect(isPrintShippableLocale('en')).toBe(true);
  });

  it('keeps print for unknown locale cookie values', () => {
    expect(isPrintShippableLocale('fr')).toBe(true);
    expect(isPrintShippableLocale('')).toBe(true);
  });

  it('derives ja gating from the shipping config, not a hardcoded flag', () => {
    // The gate must flip the day SHIPPING_TIERS covers JP.
    expect(isPrintShippableLocale('ja')).toBe(
      getAllowedCountries().includes('JP'),
    );
  });
});
